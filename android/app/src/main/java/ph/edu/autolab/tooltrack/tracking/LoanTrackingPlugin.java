package ph.edu.autolab.tooltrack.tracking;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * `LoanTracking` — the web app's handle on {@link LoanTrackingService}.
 *
 * The web app decides; this only carries the decision out. It calls `start`
 * with the account's open loans after checking them with the server, `stop` when
 * there are none (or on sign-out), and drains the readings the service has
 * queued with `getPending` / `acknowledge`. Each new reading is also announced
 * as a `checkpoint` event so it can be written straight away.
 *
 * Permissions are the location pair the geolocation plugin also declares, as two
 * aliases for the same reason it has them: Android 12+ lets the person grant
 * only the approximate one, and that is still enough to track with.
 */
@CapacitorPlugin(
    name = "LoanTracking",
    permissions = {
        @Permission(
            alias = LoanTrackingPlugin.LOCATION,
            strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }
        ),
        @Permission(alias = LoanTrackingPlugin.COARSE_LOCATION, strings = { Manifest.permission.ACCESS_COARSE_LOCATION })
    }
)
public class LoanTrackingPlugin extends Plugin {

    static final String LOCATION = "location";
    static final String COARSE_LOCATION = "coarseLocation";

    /**
     * How long one `start` stands without the web app confirming it again. The
     * web app renews it every time it checks the loans with the server; if it
     * cannot — the app has not been opened for this long — the service stops
     * itself rather than track a loan nobody can confirm is still open.
     */
    private static final long LEASE_MS = 12 * 60 * 60 * 1000L;

    private static WeakReference<LoanTrackingPlugin> current = new WeakReference<>(null);

    @Override
    public void load() {
        current = new WeakReference<>(this);
    }

    @Override
    protected void handleOnDestroy() {
        if (current.get() == this) current.clear();
        super.handleOnDestroy();
    }

    /** From the service: a reading was queued. A no-op while no WebView is alive. */
    static void emitCheckpoint(JSONObject point) {
        LoanTrackingPlugin plugin = current.get();
        if (plugin == null) return;
        try {
            plugin.notifyListeners("checkpoint", JSObject.fromJSONObject(point));
        } catch (JSONException ignored) {
            // The point stays queued; the next drain picks it up.
        }
    }

    @PluginMethod
    public void start(PluginCall call) {
        String userId = call.getString("userId");
        List<String> loans = strings(call.getArray("transactionIds"));
        if (userId == null || userId.isEmpty() || loans.isEmpty()) {
            call.reject("An account and at least one open loan are required.", "INVALID");
            return;
        }
        if (!LoanTrackingService.hasLocationPermission(getContext())) {
            call.reject("Location permission is required to track a borrowed tool.", "PERMISSION");
            return;
        }

        LoanTrackingStore store = new LoanTrackingStore(getContext());
        // Another account's readings never carry over to this one.
        if (!userId.equals(store.userId())) store.clearQueue();
        store.activate(userId, loans, System.currentTimeMillis() + LEASE_MS);

        try {
            LoanTrackingService.startOrRefresh(getContext());
        } catch (RuntimeException e) {
            // Android 12+ refuses to start a foreground service from the
            // background. The web app only calls this while visible, and retries.
            store.deactivate();
            store.setError("start: " + e.getClass().getSimpleName());
            call.reject("Location tracking could not start right now.", "START_FAILED", e);
            return;
        }
        call.resolve(status(store));
    }

    @PluginMethod
    public void stop(PluginCall call) {
        LoanTrackingStore store = new LoanTrackingStore(getContext());
        // Deactivate before anything else: from this line on, a reading that is
        // still on its way cannot be queued.
        store.deactivate();
        if (Boolean.TRUE.equals(call.getBoolean("clearQueue", false))) store.clearQueue();
        LoanTrackingService.stop(getContext(), call.getString("message"));
        call.resolve(status(store));
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(status(new LoanTrackingStore(getContext())));
    }

    @PluginMethod
    public void getPending(PluginCall call) {
        JSONArray queue = new LoanTrackingStore(getContext()).pending();
        JSObject result = new JSObject();
        try {
            result.put("points", new JSArray(queue.toString()));
        } catch (JSONException e) {
            result.put("points", new JSArray());
        }
        call.resolve(result);
    }

    @PluginMethod
    public void acknowledge(PluginCall call) {
        Set<String> ids = new HashSet<>(strings(call.getArray("ids")));
        int removed = new LoanTrackingStore(getContext()).acknowledge(ids);
        JSObject result = new JSObject();
        result.put("removed", removed);
        call.resolve(result);
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            .setData(Uri.fromParts("package", getContext().getPackageName(), null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    private static JSObject status(LoanTrackingStore store) {
        JSObject result = new JSObject();
        result.put("running", LoanTrackingService.isRunning());
        result.put("active", store.isActive());
        result.put("transactionIds", new JSArray(store.transactionIds()));
        result.put("pending", store.pendingCount());
        result.put("lastError", store.lastError());
        result.put("intervalMs", LoanTrackingService.CHECKPOINT_INTERVAL_MS);
        result.put("movementMetres", (double) LoanTrackingService.MOVEMENT_METRES);
        return result;
    }

    private static List<String> strings(JSArray array) {
        List<String> out = new ArrayList<>();
        if (array == null) return out;
        for (int i = 0; i < array.length(); i++) {
            String value = array.optString(i, null);
            if (value != null && !value.isEmpty() && !out.contains(value)) out.add(value);
        }
        return out;
    }
}
