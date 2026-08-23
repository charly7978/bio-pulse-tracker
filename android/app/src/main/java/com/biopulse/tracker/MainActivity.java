package com.biopulse.tracker;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(Camera2PpgPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
