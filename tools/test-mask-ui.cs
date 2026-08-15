// test-mask-ui.cs — functional check of the compiled shell.exe SplashForm mask.
// Loads _build\shell.exe, instantiates the private nested SplashForm via
// reflection on an STA thread, and verifies ShowMask / HideMask /
// MarkDesktopOpened behavior on the real binary. Prints PASS/FAIL lines.
using System;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

internal static class MaskUiTest
{
    private sealed class Result { public bool Ok = true; }

    [STAThread]
    private static int Main(string[] args)
    {
        string shellPath = args.Length > 0 ? args[0] : "_build\\shell.exe";
        if (!System.IO.File.Exists(shellPath))
        {
            Console.WriteLine("FAIL: shell not found at " + shellPath);
            return 1;
        }
        Result r = new Result();
        Exception error = null;
        Thread t = new Thread(delegate()
        {
            try { Run(shellPath, r); }
            catch (Exception ex) { error = ex; r.Ok = false; }
        });
        t.SetApartmentState(ApartmentState.STA);
        t.Start();
        t.Join();
        if (error != null) Console.WriteLine("FAIL: exception: " + error);
        Console.WriteLine(r.Ok ? "ALL PASS" : "SOME FAILED");
        return r.Ok ? 0 : 1;
    }

    private static void Run(string shellPath, Result r)
    {
        Assembly asm = Assembly.LoadFrom(shellPath);
        Type splash = asm.GetType("Program+SplashForm", true);
        object form = Activator.CreateInstance(splash, true);

        FieldInfo panelField = splash.GetField("maskPanel", BindingFlags.Instance | BindingFlags.NonPublic);
        FieldInfo titleField = splash.GetField("maskTitle", BindingFlags.Instance | BindingFlags.NonPublic);
        FieldInfo subField = splash.GetField("maskSub", BindingFlags.Instance | BindingFlags.NonPublic);
        FieldInfo openedField = splash.GetField("desktopOpened", BindingFlags.Instance | BindingFlags.NonPublic);
        MethodInfo showMask = splash.GetMethod("ShowMask");
        MethodInfo hideMask = splash.GetMethod("HideMask");
        MethodInfo markOpened = splash.GetMethod("MarkDesktopOpened");

        if (panelField == null || titleField == null || subField == null || openedField == null ||
            showMask == null || hideMask == null || markOpened == null)
        {
            Console.WriteLine("FAIL: mask members not found in " + splash.FullName);
            r.Ok = false;
            return;
        }

        Panel panel = (Panel)panelField.GetValue(form);
        Label title = (Label)titleField.GetValue(form);
        Label sub = (Label)subField.GetValue(form);
        FieldInfo logField = splash.GetField("maskLog", BindingFlags.Instance | BindingFlags.NonPublic);
        if (panel == null || title == null || sub == null || logField == null)
        {
            Console.WriteLine("FAIL: mask controls are null");
            r.Ok = false;
            return;
        }
        TextBox maskLog = (TextBox)logField.GetValue(form);

        // create the handle and show the form so child Visible reflects reality
        object handleVal = form.GetType().GetProperty("Handle").GetValue(form, null);
        IntPtr h = (handleVal is IntPtr) ? (IntPtr)handleVal : IntPtr.Zero;
        Console.WriteLine("handle created: " + (h != IntPtr.Zero));
        if (h == IntPtr.Zero) { r.Ok = false; return; }
        ((Form)form).Show();
        Application.DoEvents();
        Console.WriteLine("window shown, form.Visible: " + ((Form)form).Visible);

        Console.WriteLine("initial maskPanel.Visible: " + panel.Visible + " (expect True: Shown event shows the loading mask)");
        if (!panel.Visible) { r.Ok = false; }

        showMask.Invoke(form, new object[] { "加载中..." });
        Application.DoEvents();
        Console.WriteLine("after ShowMask -> Visible: " + panel.Visible + " (expect True)");
        Console.WriteLine("maskTitle.Text: " + title.Text + " (expect 加载中...)");
        if (!panel.Visible) r.Ok = false;
        if (title.Text != "加载中...") r.Ok = false;

        // --- centering check: each mask child should be horizontally centered ---
        int pw = panel.ClientSize.Width;
        Console.WriteLine("panel width: " + pw);
        foreach (Control c in panel.Controls)
        {
            int left = c.Left;
            int right = c.Right;
            int margin = Math.Min(left, pw - right);
            bool centered = Math.Abs(left - (pw - right)) <= 2;
            Console.WriteLine("  " + c.GetType().Name + " left=" + left + " right=" + right +
                " centerOff=" + Math.Abs(left - (pw - right)) + (centered ? " [CENTERED]" : " [OFF]"));
            if (!centered) r.Ok = false;
        }
        // maskLog should mirror the startup text (log box content)
        Console.WriteLine("maskLog.Text len: " + maskLog.Text.Length + " (expect >0 after log push)");
        if (maskLog.Text.Length <= 0) { Console.WriteLine("WARN: maskLog empty (log not pushed yet in this test)"); }

        hideMask.Invoke(form, null);
        Application.DoEvents();
        Console.WriteLine("after HideMask -> Visible: " + panel.Visible + " (expect False)");
        if (panel.Visible) r.Ok = false;

        showMask.Invoke(form, new object[] { "正在打开界面..." });
        Application.DoEvents();
        Console.WriteLine("maskSub.Text: " + sub.Text + " (expect 正在打开界面...)");
        if (sub.Text != "正在打开界面...") r.Ok = false;

        markOpened.Invoke(form, null);
        Application.DoEvents();
        bool opened = (bool)openedField.GetValue(form);
        Console.WriteLine("after MarkDesktopOpened -> desktopOpened: " + opened + " (expect True)");
        Console.WriteLine("after MarkDesktopOpened -> Visible: " + panel.Visible + " (expect False)");
        if (!opened || panel.Visible) r.Ok = false;

        // buttons above the mask
        Form f = (Form)form;
        Button openBtn = (Button)splash.GetField("openButton", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(form);
        showMask.Invoke(form, new object[] { "" });
        Application.DoEvents();
        int maskIdx = f.Controls.GetChildIndex(panel);
        int btnIdx = f.Controls.GetChildIndex(openBtn);
        Console.WriteLine("z-index mask=" + maskIdx + " openButton=" + btnIdx + " (smaller index = on top; openButton should be on top)");
        if (btnIdx >= maskIdx) { Console.WriteLine("WARN: openButton not above mask (still clickable? check)"); }

        // cleanup: hide tray icon, dispose
        try
        {
            FieldInfo tray = splash.GetField("trayIcon", BindingFlags.Instance | BindingFlags.NonPublic);
            NotifyIcon icon = tray != null ? (NotifyIcon)tray.GetValue(form) : null;
            if (icon != null) { icon.Visible = false; icon.Dispose(); }
        }
        catch { }
        ((Form)form).Dispose();
    }
}
