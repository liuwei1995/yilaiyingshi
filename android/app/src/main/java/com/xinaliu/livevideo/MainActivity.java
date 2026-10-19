package com.xinaliu.livevideo;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
	@Override
	public void onCreate(Bundle savedInstanceState) {
		registerPlugin(NativeDlnaPlugin.class);
		super.onCreate(savedInstanceState);
	}
}