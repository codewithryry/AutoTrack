package ph.edu.autolab.tooltrack;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import ph.edu.autolab.tooltrack.tracking.LoanTrackingPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-local plugins are registered by hand, before the bridge starts;
        // `npx cap sync` only discovers the ones installed from npm.
        registerPlugin(LoanTrackingPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
