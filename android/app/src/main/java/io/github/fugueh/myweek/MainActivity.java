package io.github.fugueh.myweek;

import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.view.Window;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // 和网页里 theme-color 一致：浅色 / 深色模式的页面底色
    private static final int LIGHT_BG = 0xFFF3F5F7, DARK_BG = 0xFF161A22;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 自己写的插件要在 super.onCreate 之前注册
        registerPlugin(FolderStorePlugin.class);
        super.onCreate(savedInstanceState);
        applySystemBars(getResources().getConfiguration());

        // 返回键：页面里有可以退回的历史（日记页压了一条、大图 / 新功能弹窗各压了一条）就退回，
        // 页面那边在 popstate 里切回周页面；没有了才退出 App。
        // Capacitor 自己不处理返回键（没装 @capacitor/app 插件时），不写这段，返回键会直接退出。
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView web = getBridge() != null ? getBridge().getWebView() : null;
                if (web != null && web.canGoBack()) {
                    web.goBack();
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
            }
        });
    }

    // 系统切换浅色 / 深色：AndroidManifest 里声明了自己处理 uiMode，Activity 不会重建，
    // 主题（styles.xml）里写死的状态栏图标颜色和底色就不会跟着换，要在这里手动设一遍。
    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        applySystemBars(newConfig);
    }

    // App 在后台时系统换了模式，回来时可能错过了上面的回调，再对一次
    @Override
    public void onResume() {
        super.onResume();
        applySystemBars(getResources().getConfiguration());
    }

    @SuppressWarnings("deprecation")
    private void applySystemBars(Configuration cfg) {
        boolean night = (cfg.uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        int bg = night ? DARK_BG : LIGHT_BG;
        Window window = getWindow();
        // 状态栏、导航栏的图标：浅色模式用深色图标，深色模式用浅色图标
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(window, window.getDecorView());
        bars.setAppearanceLightStatusBars(!night);
        bars.setAppearanceLightNavigationBars(!night);
        // 状态栏后面的底色：窗口和 WebView 都跟着换（capacitor.config.json 里的 backgroundColor 是写死的浅色）
        window.getDecorView().setBackgroundColor(bg);
        if (getBridge() != null && getBridge().getWebView() != null) getBridge().getWebView().setBackgroundColor(bg);
        if (Build.VERSION.SDK_INT < 35) {   // Android 15 起系统栏是透明的，这两个设置不再生效
            window.setStatusBarColor(bg);
            window.setNavigationBarColor(bg);
        }
    }
}
