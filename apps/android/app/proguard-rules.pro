-keep class com.google.mlkit.** { *; }
-keepclassmembers class io.homedash.kiosk.MainActivity$HomeDashBridge {
    @android.webkit.JavascriptInterface <methods>;
}
