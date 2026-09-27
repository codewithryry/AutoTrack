package ph.edu.autolab.tooltrack.tracking;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

import com.google.android.gms.location.CurrentLocationRequest;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import com.google.android.gms.tasks.CancellationTokenSource;

import org.json.JSONObject;

import java.text.DateFormat;
import java.util.Date;

import ph.edu.autolab.tooltrack.R;

/**
 * The one location watcher on this device while its user has a tool out.
 *
 * A foreground service of type `location`, so Android keeps it — and its
 * location updates — alive with the app minimised or swiped away, and so the
 * person always sees that it is running: the notification cannot be dismissed
 * while it is. It exists only between the web app's `start` and its `stop`, and
 * the web app only starts it for an account that has an open loan.
 *
 * Hybrid cadence, tuned for battery:
 *
 *   - A balanced-power request (Wi-Fi / cell, GPS only if the system already has
 *     it) delivers a coarse position every couple of minutes. That is only the
 *     movement detector; it is never stored.
 *   - A checkpoint is taken when that position has moved more than
 *     {@link #MOVEMENT_METRES} from the last stored checkpoint (and by more than
 *     the two readings' combined uncertainty, so Wi-Fi/cell jitter is not
 *     mistaken for movement), or when {@link #CHECKPOINT_INTERVAL_MS} has passed
 *     since the last one.
 *   - The checkpoint itself is a fresh high-accuracy fix (a cached one up to 30s
 *     old is accepted), so what is stored is as precise as the phone can give,
 *     with its accuracy kept.
 *
 * Readings are queued in {@link LoanTrackingStore} against the loans open at
 * that moment and handed to the web app, which writes them to the database. A
 * point is never written from here.
 */
public class LoanTrackingService extends Service {

    static final String ACTION_START = "ph.edu.autolab.tooltrack.tracking.START";

    static final String CHANNEL_ID = "loan_tracking";
    static final int NOTIFICATION_ID = 4201;
    static final int STOPPED_NOTIFICATION_ID = 4202;

    /** The longest the loan goes without a checkpoint while a fix is available. */
    static final long CHECKPOINT_INTERVAL_MS = 10 * 60 * 1000L;
    /** Movement that earns a checkpoint before the interval is up. */
    static final float MOVEMENT_METRES = 100f;

    /** The movement detector's cadence. */
    private static final long UPDATE_INTERVAL_MS = 2 * 60 * 1000L;
    private static final long MIN_UPDATE_INTERVAL_MS = 60 * 1000L;
    /** How often the interval is checked when no update has arrived. */
    private static final long WATCHDOG_MS = 60 * 1000L;
    /** How long a checkpoint waits for a fresh fix. */
    private static final long FIX_TIMEOUT_MS = 30 * 1000L;
    private static final long FIX_MAX_AGE_MS = 30 * 1000L;
    /** A detector position this recent may stand in when no fresh fix comes. */
    private static final long FALLBACK_MAX_AGE_MS = 2 * 60 * 1000L;
    /** After a failed fix (no GPS, location off), wait this long before trying again. */
    private static final long RETRY_AFTER_FAILURE_MS = 2 * 60 * 1000L;

    private static volatile boolean running = false;
    private static volatile LoanTrackingService instance = null;
    /** What the "stopped" notification says; set by whoever asks for the stop. */
    private static volatile String stopMessage = null;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private LoanTrackingStore store;
    private FusedLocationProviderClient client;
    private LocationCallback callback;
    private CancellationTokenSource pendingFix;
    private boolean capturing = false;
    /** Whether this instance ever began tracking — what decides the "stopped" notice. */
    private boolean tracked = false;

    /** The last stored checkpoint, or the first detector position before one. */
    private Location reference;
    private long lastSavedAt = 0L;
    private long nextAttemptAt = 0L;

    private final Runnable watchdog = new Runnable() {
        @Override
        public void run() {
            if (!running) return;
            tick(null);
            handler.postDelayed(this, WATCHDOG_MS);
        }
    };

    /* ------------------------------------------------------------------ *
     * Entry points for the plugin
     * ------------------------------------------------------------------ */

    static boolean isRunning() {
        return running;
    }

    /**
     * Start the service, or — when it is already running — have it re-read the
     * loans and the lease. A running service is refreshed in place rather than
     * started again: Android refuses to *start* a foreground service while the
     * app is in the background, and a loan can change while it is.
     */
    static void startOrRefresh(Context context) {
        LoanTrackingService current = instance;
        if (running && current != null) {
            new Handler(Looper.getMainLooper()).post(current::refresh);
            return;
        }
        Intent intent = new Intent(context, LoanTrackingService.class).setAction(ACTION_START);
        ContextCompat.startForegroundService(context, intent);
    }

    /** Stop it. The store has already been deactivated by the caller. */
    static void stop(Context context, @Nullable String message) {
        stopMessage = message;
        LoanTrackingService current = instance;
        if (current != null) {
            new Handler(Looper.getMainLooper()).post(() -> current.finish(message));
        } else {
            context.stopService(new Intent(context, LoanTrackingService.class));
        }
    }

    static boolean hasLocationPermission(Context context) {
        return granted(context, Manifest.permission.ACCESS_FINE_LOCATION)
            || granted(context, Manifest.permission.ACCESS_COARSE_LOCATION);
    }

    private static boolean granted(Context context, String permission) {
        return ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED;
    }

    /* ------------------------------------------------------------------ *
     * Lifecycle
     * ------------------------------------------------------------------ */

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        store = new LoanTrackingStore(this);
        client = LocationServices.getFusedLocationProviderClient(this);
        ensureChannel(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Foreground first, always: after startForegroundService() Android
        // requires startForeground() promptly, even when the next step is to stop.
        if (!enterForeground()) {
            stopSelf();
            return START_NOT_STICKY;
        }
        refresh();
        // Not sticky: if the system kills the process, tracking stays off until
        // the web app — which can check the loan with the server — starts it
        // again. A restart from here could not know whether the loan still exists.
        return START_NOT_STICKY;
    }

    /** Re-read the decision; begin, carry on, or stop accordingly. */
    private void refresh() {
        if (store.leaseExpired() && store.isActive()) {
            store.deactivate();
            finish("Open Tool Track to resume recording your borrowed tool's location.");
            return;
        }
        if (!store.isActive()) {
            finish(stopMessage);
            return;
        }
        if (!hasLocationPermission(this)) {
            store.setError("permission");
            finish("Location permission was turned off, so Tool Track stopped recording.");
            return;
        }
        if (!running) begin();
        updateNotification();
    }

    @Override
    public void onDestroy() {
        stopUpdates();
        if (instance == this) instance = null;
        if (tracked) postStopped(this, stopMessage);
        stopMessage = null;
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private boolean enterForeground() {
        try {
            int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
                : 0;
            ServiceCompat.startForeground(this, NOTIFICATION_ID, buildOngoing(), type);
            return true;
        } catch (RuntimeException e) {
            // ForegroundServiceStartNotAllowedException (started from the
            // background, Android 12+) or SecurityException (no location
            // permission, Android 14+). The web app retries when it is visible.
            if (store != null) store.setError("foreground: " + e.getClass().getSimpleName());
            return false;
        }
    }

    /* ------------------------------------------------------------------ *
     * Location
     * ------------------------------------------------------------------ */

    // Every caller has checked hasLocationPermission(); a revocation in between
    // lands in the SecurityException handler below.
    @SuppressLint("MissingPermission")
    private void begin() {
        running = true;
        tracked = true;
        reference = null;
        lastSavedAt = System.currentTimeMillis();
        nextAttemptAt = 0L;

        LocationRequest request = new LocationRequest.Builder(
            Priority.PRIORITY_BALANCED_POWER_ACCURACY,
            UPDATE_INTERVAL_MS
        )
            .setMinUpdateIntervalMillis(MIN_UPDATE_INTERVAL_MS)
            .build();

        callback = new LocationCallback() {
            @Override
            public void onLocationResult(@NonNull LocationResult result) {
                tick(result.getLastLocation());
            }
        };

        try {
            client.requestLocationUpdates(request, callback, Looper.getMainLooper());
        } catch (SecurityException e) {
            store.setError("permission");
            finish("Location permission was turned off, so Tool Track stopped recording.");
            return;
        }
        handler.postDelayed(watchdog, WATCHDOG_MS);
    }

    /** One decision: movement, the interval, or nothing. */
    private void tick(@Nullable Location update) {
        if (!running) return;
        if (store.leaseExpired() || !store.isActive() || !hasLocationPermission(this)) {
            refresh();
            return;
        }

        long now = System.currentTimeMillis();
        if (capturing || now < nextAttemptAt) return;

        if (update != null && reference == null) reference = update;

        boolean moved = update != null && reference != null && update != reference
            && movedBetween(reference, update);
        boolean due = now - lastSavedAt >= CHECKPOINT_INTERVAL_MS;

        if (moved) {
            capture("movement", update);
        } else if (due) {
            capture("interval", update);
        }
    }

    private static boolean movedBetween(Location from, Location to) {
        float distance = from.distanceTo(to);
        float noise = (from.hasAccuracy() ? from.getAccuracy() : 0f)
            + (to.hasAccuracy() ? to.getAccuracy() : 0f);
        return distance >= MOVEMENT_METRES && distance > noise;
    }

    @SuppressLint("MissingPermission")
    private void capture(String reason, @Nullable Location fallback) {
        capturing = true;
        pendingFix = new CancellationTokenSource();

        boolean precise = granted(this, Manifest.permission.ACCESS_FINE_LOCATION);
        CurrentLocationRequest request = new CurrentLocationRequest.Builder()
            .setPriority(precise ? Priority.PRIORITY_HIGH_ACCURACY : Priority.PRIORITY_BALANCED_POWER_ACCURACY)
            .setMaxUpdateAgeMillis(FIX_MAX_AGE_MS)
            .setDurationMillis(FIX_TIMEOUT_MS)
            .build();

        try {
            client.getCurrentLocation(request, pendingFix.getToken()).addOnCompleteListener(task -> {
                capturing = false;
                pendingFix = null;
                // Stopped while the fix was on its way: it belongs to nothing.
                if (!running) return;

                Location fix = task.isSuccessful() ? task.getResult() : null;
                if (fix == null && fallback != null
                    && System.currentTimeMillis() - fallback.getTime() <= FALLBACK_MAX_AGE_MS) {
                    fix = fallback;
                }
                if (fix == null) {
                    // No fix at all — GPS off, indoors with no network location.
                    // Nothing is stored and nothing crashes; try again shortly.
                    nextAttemptAt = System.currentTimeMillis() + RETRY_AFTER_FAILURE_MS;
                    return;
                }
                record(fix, reason);
            });
        } catch (SecurityException e) {
            capturing = false;
            pendingFix = null;
            store.setError("permission");
            finish("Location permission was turned off, so Tool Track stopped recording.");
        }
    }

    private void record(Location fix, String reason) {
        JSONObject point = store.enqueue(
            fix.getLatitude(),
            fix.getLongitude(),
            fix.hasAccuracy() ? fix.getAccuracy() : null,
            fix.getTime(),
            reason
        );
        if (point == null) return; // tracking was turned off meanwhile
        reference = fix;
        lastSavedAt = System.currentTimeMillis();
        updateNotification();
        LoanTrackingPlugin.emitCheckpoint(point);
    }

    private void stopUpdates() {
        running = false;
        handler.removeCallbacks(watchdog);
        if (callback != null && client != null) {
            client.removeLocationUpdates(callback);
        }
        callback = null;
        if (pendingFix != null) {
            pendingFix.cancel();
            pendingFix = null;
        }
        capturing = false;
    }

    /** Stop updates first, then the foreground state, then the service. */
    private void finish(@Nullable String message) {
        if (message != null) stopMessage = message;
        stopUpdates();
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
        // onDestroy() posts the "stopped" notice if tracking had been running.
    }

    /* ------------------------------------------------------------------ *
     * Notifications
     * ------------------------------------------------------------------ */

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Borrowed tool location",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Shown while Tool Track records the location of a tool you have borrowed.");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    private static PendingIntent openApp(Context context) {
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch == null) return null;
        launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(
            context,
            0,
            launch,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
    }

    private Notification buildOngoing() {
        int loans = store == null ? 1 : Math.max(1, store.transactionIds().size());
        String text = loans == 1
            ? "Tracking your borrowed tool's location."
            : "Tracking the location of your " + loans + " borrowed tools.";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_tooltrack)
            .setContentTitle("Tool Track — Location tracking active")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(openApp(this));

        if (running && reference != null && lastSavedAt > 0) {
            builder.setSubText("Last recorded " + DateFormat.getTimeInstance(DateFormat.SHORT).format(new Date(lastSavedAt)));
        }
        return builder.build();
    }

    private void updateNotification() {
        if (!canNotify(this)) return;
        try {
            NotificationManagerCompat.from(this).notify(NOTIFICATION_ID, buildOngoing());
        } catch (SecurityException ignored) {
            // POST_NOTIFICATIONS revoked; the foreground state itself is unaffected.
        }
    }

    static void postStopped(Context context, @Nullable String message) {
        if (!canNotify(context)) return;
        ensureChannel(context);
        Notification notification = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_tooltrack)
            .setContentTitle("Tool Track — Location tracking stopped")
            .setContentText(message != null ? message : "You have no borrowed tools, so location tracking is off.")
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(openApp(context))
            .build();
        try {
            NotificationManagerCompat.from(context).notify(STOPPED_NOTIFICATION_ID, notification);
        } catch (SecurityException ignored) {
            // Not allowed to post; nothing else to do.
        }
    }

    private static boolean canNotify(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && !granted(context, Manifest.permission.POST_NOTIFICATIONS)) {
            return false;
        }
        return NotificationManagerCompat.from(context).areNotificationsEnabled();
    }
}
