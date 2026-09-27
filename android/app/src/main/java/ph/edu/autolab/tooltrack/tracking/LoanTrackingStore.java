package ph.edu.autolab.tooltrack.tracking;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * What the loan tracker needs to survive the WebView going away.
 *
 * Two things live here, in the app's private SharedPreferences:
 *
 *   - the tracking decision the web app made — which account, which open loans,
 *     and until when that decision stands (the lease);
 *   - the readings the service has taken and the web app has not yet
 *     acknowledged. This is the offline queue: a point stays here until the web
 *     app has had the database's answer for every loan it belongs to.
 *
 * Nothing here talks to the network. Every write to the database is made by the
 * web app, through the signed-in Supabase session, so the server's checks — the
 * borrower, the open loan — apply to every point.
 */
final class LoanTrackingStore {

    private static final String PREFS = "tooltrack.loan_tracking";
    private static final String KEY_ACTIVE = "active";
    private static final String KEY_USER = "userId";
    private static final String KEY_LOANS = "transactionIds";
    private static final String KEY_LEASE = "leaseUntil";
    private static final String KEY_QUEUE = "queue";
    private static final String KEY_SEQ = "seq";
    private static final String KEY_ERROR = "lastError";

    /**
     * The most readings kept waiting. At one every 10 minutes that is more than
     * three days offline; past it the oldest go first, since the newest reading
     * is the one that answers "where is it now".
     */
    static final int MAX_QUEUE = 500;

    /** One lock for every instance: the plugin and the service each make their own. */
    private static final Object LOCK = new Object();

    private final SharedPreferences prefs;

    LoanTrackingStore(Context context) {
        prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /* ------------------------------ decision ------------------------------ */

    void activate(String userId, List<String> transactionIds, long leaseUntil) {
        synchronized (LOCK) {
            prefs.edit()
                .putBoolean(KEY_ACTIVE, true)
                .putString(KEY_USER, userId)
                .putString(KEY_LOANS, new JSONArray(transactionIds).toString())
                .putLong(KEY_LEASE, leaseUntil)
                .remove(KEY_ERROR)
                .apply();
        }
    }

    /** Tracking is off: no loans, so nothing the service takes can be queued. */
    void deactivate() {
        synchronized (LOCK) {
            prefs.edit()
                .putBoolean(KEY_ACTIVE, false)
                .putString(KEY_LOANS, "[]")
                .putLong(KEY_LEASE, 0L)
                .apply();
        }
    }

    boolean isActive() {
        synchronized (LOCK) {
            return prefs.getBoolean(KEY_ACTIVE, false) && !loansLocked().isEmpty();
        }
    }

    boolean leaseExpired() {
        synchronized (LOCK) {
            return System.currentTimeMillis() > prefs.getLong(KEY_LEASE, 0L);
        }
    }

    String userId() {
        synchronized (LOCK) {
            return prefs.getString(KEY_USER, null);
        }
    }

    List<String> transactionIds() {
        synchronized (LOCK) {
            return loansLocked();
        }
    }

    private List<String> loansLocked() {
        List<String> ids = new ArrayList<>();
        try {
            JSONArray array = new JSONArray(prefs.getString(KEY_LOANS, "[]"));
            for (int i = 0; i < array.length(); i++) {
                String id = array.optString(i, null);
                if (id != null && !id.isEmpty()) ids.add(id);
            }
        } catch (JSONException ignored) {
            // A corrupt entry is "no loans", which is the safe reading of it.
        }
        return ids;
    }

    void setError(String error) {
        synchronized (LOCK) {
            prefs.edit().putString(KEY_ERROR, error).apply();
        }
    }

    String lastError() {
        synchronized (LOCK) {
            return prefs.getString(KEY_ERROR, null);
        }
    }

    /* -------------------------------- queue -------------------------------- */

    /**
     * Queue one reading against the loans that are open right now.
     *
     * The loan ids are copied onto the point at the moment it is taken, so a
     * reading can only ever be attached to a loan that was being tracked when it
     * was measured. Returns null — and queues nothing — once tracking is off.
     */
    JSONObject enqueue(double lat, double lng, Float accuracy, long capturedAtMs, String reason) {
        synchronized (LOCK) {
            if (!prefs.getBoolean(KEY_ACTIVE, false)) return null;
            List<String> loans = loansLocked();
            if (loans.isEmpty()) return null;

            long seq = prefs.getLong(KEY_SEQ, 0L) + 1;
            JSONObject point = new JSONObject();
            try {
                point.put("id", capturedAtMs + "-" + seq);
                point.put("lat", lat);
                point.put("lng", lng);
                point.put("accuracy", accuracy == null ? JSONObject.NULL : (double) accuracy);
                point.put("capturedAtMs", capturedAtMs);
                point.put("reason", reason);
                point.put("transactionIds", new JSONArray(loans));
            } catch (JSONException e) {
                return null;
            }

            JSONArray queue = queueLocked();
            queue.put(point);
            while (queue.length() > MAX_QUEUE) queue.remove(0);
            prefs.edit()
                .putLong(KEY_SEQ, seq)
                .putString(KEY_QUEUE, queue.toString())
                .apply();
            return point;
        }
    }

    JSONArray pending() {
        synchronized (LOCK) {
            return queueLocked();
        }
    }

    int pendingCount() {
        synchronized (LOCK) {
            return queueLocked().length();
        }
    }

    /** Drop the points the web app has settled. Returns how many were removed. */
    int acknowledge(Set<String> ids) {
        if (ids == null || ids.isEmpty()) return 0;
        synchronized (LOCK) {
            JSONArray queue = queueLocked();
            JSONArray kept = new JSONArray();
            int removed = 0;
            for (int i = 0; i < queue.length(); i++) {
                JSONObject point = queue.optJSONObject(i);
                if (point == null) continue;
                if (ids.contains(point.optString("id"))) {
                    removed++;
                } else {
                    kept.put(point);
                }
            }
            prefs.edit().putString(KEY_QUEUE, kept.toString()).apply();
            return removed;
        }
    }

    void clearQueue() {
        synchronized (LOCK) {
            prefs.edit().putString(KEY_QUEUE, "[]").apply();
        }
    }

    private JSONArray queueLocked() {
        try {
            return new JSONArray(prefs.getString(KEY_QUEUE, "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }
}
