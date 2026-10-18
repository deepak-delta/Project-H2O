package com.delta.projecth2o;

import android.os.Bundle;
import android.webkit.CookieManager;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Fingerprint / face login (passkeys) inside the app. The site lists this app in
        // /.well-known/assetlinks.json, so the passkeys belong to the same account as the website.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_AUTHENTICATION)) {
            WebSettingsCompat.setWebAuthenticationSupport(
                getBridge().getWebView().getSettings(),
                WebSettingsCompat.WEB_AUTHENTICATION_SUPPORT_FOR_APP
            );
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        // Save the login cookie now: Android may close the app in the background before the
        // WebView would have written it, and the user would find themselves logged out.
        CookieManager.getInstance().flush();
    }
}
