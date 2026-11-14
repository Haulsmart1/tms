package cloud.tmswizard.mobile;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.google.androidbrowserhelper.trusted.LauncherActivity;

public final class WorkspaceActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.workspace_picker);
        findViewById(R.id.open_driver).setOnClickListener(view -> open("/driver/dashboard"));
        findViewById(R.id.open_warehouse).setOnClickListener(view -> open("/warehouse"));
    }

    private void open(String path) {
        Intent intent = new Intent(this, LauncherActivity.class);
        intent.setData(Uri.parse("https://tmswizard.cloud" + path));
        startActivity(intent);
    }
}
