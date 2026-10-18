package io.github.fugueh.myweek;

import android.app.Activity;
import android.content.Intent;
import android.content.UriPermission;
import android.net.Uri;

import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * 让 App 读写用户自己选的文件夹（比如「文档/我的一周」）。
 *
 * 用的是系统的文件夹选择器（Storage Access Framework）：用户选一次，授权一直保留；
 * 文件属于用户，卸载 App 不会被删，用别的编辑器、网盘都能打开。
 *
 * JS 侧（web/js/store.js 的 appFolder）调用：
 *   pick()                      → { uri, name }     弹出选择器
 *   hasAccess({uri})            → { ok }            授权还在不在
 *   list({uri})                 → { files: [{name, lastModified}] }   只列 .md
 *   stat({uri, name})           → { lastModified }  不存在时没有这个字段
 *   read({uri, name})           → { text, lastModified }
 *   write({uri, name, text})    → { lastModified }  不存在就新建，存在就整个覆盖
 */
@CapacitorPlugin(name = "FolderStore")
public class FolderStorePlugin extends Plugin {

    @PluginMethod
    public void pick(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        startActivityForResult(call, intent, "pickResult");
    }

    @ActivityCallback
    private void pickResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("没有选文件夹", "cancelled");
            return;
        }
        Uri tree = result.getData().getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(tree,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (SecurityException e) {
            call.reject("没拿到这个文件夹的长期权限：" + e.getMessage());
            return;
        }
        DocumentFile dir = DocumentFile.fromTreeUri(getContext(), tree);
        JSObject ret = new JSObject();
        ret.put("uri", tree.toString());
        ret.put("name", dir != null && dir.getName() != null ? dir.getName() : "所选文件夹");
        call.resolve(ret);
    }

    @PluginMethod
    public void hasAccess(PluginCall call) {
        String uri = call.getString("uri");
        boolean ok = false;
        if (uri != null) {
            for (UriPermission p : getContext().getContentResolver().getPersistedUriPermissions()) {
                if (p.getUri().toString().equals(uri) && p.isReadPermission() && p.isWritePermission()) { ok = true; break; }
            }
            if (ok) {
                DocumentFile dir = DocumentFile.fromTreeUri(getContext(), Uri.parse(uri));
                ok = dir != null && dir.exists() && dir.isDirectory();
            }
        }
        JSObject ret = new JSObject();
        ret.put("ok", ok);
        call.resolve(ret);
    }

    @PluginMethod
    public void list(PluginCall call) {
        DocumentFile dir = folder(call);
        if (dir == null) return;
        JSArray files = new JSArray();
        for (DocumentFile f : dir.listFiles()) {
            String n = f.getName();
            if (f.isFile() && n != null && n.endsWith(".md")) {
                JSObject o = new JSObject();
                o.put("name", n);
                o.put("lastModified", f.lastModified());
                files.put(o);
            }
        }
        JSObject ret = new JSObject();
        ret.put("files", files);
        call.resolve(ret);
    }

    @PluginMethod
    public void stat(PluginCall call) {
        DocumentFile dir = folder(call);
        if (dir == null) return;
        DocumentFile f = dir.findFile(call.getString("name", ""));
        JSObject ret = new JSObject();
        if (f != null && f.isFile()) ret.put("lastModified", f.lastModified());
        call.resolve(ret);
    }

    @PluginMethod
    public void read(PluginCall call) {
        DocumentFile dir = folder(call);
        if (dir == null) return;
        DocumentFile f = dir.findFile(call.getString("name", ""));
        if (f == null || !f.isFile()) { call.reject("没有这个文件", "not_found"); return; }
        try (InputStream in = getContext().getContentResolver().openInputStream(f.getUri())) {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int n;
            while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
            JSObject ret = new JSObject();
            ret.put("text", new String(buf.toByteArray(), StandardCharsets.UTF_8));
            ret.put("lastModified", f.lastModified());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("读不出来：" + e.getMessage());
        }
    }

    @PluginMethod
    public void write(PluginCall call) {
        DocumentFile dir = folder(call);
        if (dir == null) return;
        String name = call.getString("name", "");
        String text = call.getString("text", "");
        if (!name.matches("^\\d{4}-W\\d{2}\\.md$")) { call.reject("文件名不对：" + name); return; }
        try {
            DocumentFile f = dir.findFile(name);
            // 用 octet-stream 新建，系统就不会在文件名后面再加 .txt
            if (f == null) f = dir.createFile("application/octet-stream", name);
            if (f == null) { call.reject("建不了文件 " + name); return; }
            try (OutputStream out = getContext().getContentResolver().openOutputStream(f.getUri(), "wt")) {
                out.write(text.getBytes(StandardCharsets.UTF_8));
            }
            JSObject ret = new JSObject();
            ret.put("lastModified", f.lastModified());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("写不进去：" + e.getMessage());
        }
    }

    private DocumentFile folder(PluginCall call) {
        String uri = call.getString("uri");
        DocumentFile dir = uri == null ? null : DocumentFile.fromTreeUri(getContext(), Uri.parse(uri));
        if (dir == null || !dir.exists() || !dir.isDirectory()) {
            call.reject("文件夹不见了或没有权限，请重新选择", "no_access");
            return null;
        }
        return dir;
    }
}
