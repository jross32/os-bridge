$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$source = @'
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public static class ReflexOverlayHost
{
    private const int WhKeyboardLl = 13;
    private const int WmKeyDown = 0x0100;
    private const int WmSysKeyDown = 0x0104;
    private const int VkEscape = 0x1B;
    private const int LlkhfLowerIlInjected = 0x02;
    private const int LlkhfInjected = 0x10;
    private const uint SpiSetCursors = 0x0057;
    private static readonly uint[] HighlightedCursorIds = new uint[] {
        32512, 32513, 32514, 32515, 32516, 32640, 32641, 32642,
        32643, 32644, 32645, 32646, 32648, 32649, 32650, 32651
    };

    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    private struct KbdLlHookStruct
    {
        public uint vkCode;
        public uint scanCode;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc callback, IntPtr module, uint threadId);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnhookWindowsHookEx(IntPtr hook);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hook, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string moduleName);

    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetSystemCursor(IntPtr cursor, uint cursorId);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr CopyIcon(IntPtr icon);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr CreateIconIndirect(ref IconInfo iconInfo);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetIconInfo(IntPtr icon, out IconInfo iconInfo);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyIcon(IntPtr icon);

    [DllImport("gdi32.dll", SetLastError = true)]
    private static extern bool DeleteObject(IntPtr value);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SystemParametersInfo(uint action, uint param, IntPtr value, uint flags);

    [StructLayout(LayoutKind.Sequential)]
    private struct IconInfo
    {
        public bool fIcon;
        public uint xHotspot;
        public uint yHotspot;
        public IntPtr hbmMask;
        public IntPtr hbmColor;
    }

    private static LowLevelKeyboardProc hookProc;
    private static IntPtr keyboardHook = IntPtr.Zero;
    private static OverlayContext context;

    [STAThread]
    public static void Run(string agentName, string commandDirectory, string statusPath, int parentPid, bool showCursorHalo)
    {
        try { SetProcessDPIAware(); } catch { }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        Directory.CreateDirectory(commandDirectory);
        context = new OverlayContext(agentName, commandDirectory, statusPath, parentPid, showCursorHalo);
        hookProc = KeyboardHook;

        InstallKeyboardHook();

        context.SetEscapeHookAvailable(keyboardHook != IntPtr.Zero);
        Application.Run(context);

        RemoveKeyboardHook();
        RestoreSystemCursors();
    }

    private static IntPtr KeyboardHook(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0 && (wParam == (IntPtr)WmKeyDown || wParam == (IntPtr)WmSysKeyDown))
        {
            KbdLlHookStruct data = (KbdLlHookStruct)Marshal.PtrToStructure(lParam, typeof(KbdLlHookStruct));
            bool injected = (data.flags & (LlkhfInjected | LlkhfLowerIlInjected)) != 0;
            if (!injected && data.vkCode == VkEscape && context != null)
            {
                context.EmergencyStopFromEscape();
            }
        }
        return CallNextHookEx(keyboardHook, nCode, wParam, lParam);
    }

    private static void InstallKeyboardHook()
    {
        RemoveKeyboardHook();
        using (Process current = Process.GetCurrentProcess())
        using (ProcessModule module = current.MainModule)
        {
            keyboardHook = SetWindowsHookEx(WhKeyboardLl, hookProc, GetModuleHandle(module.ModuleName), 0);
        }
    }

    private static void RemoveKeyboardHook()
    {
        if (keyboardHook == IntPtr.Zero) return;
        UnhookWindowsHookEx(keyboardHook);
        keyboardHook = IntPtr.Zero;
    }

    public static void RefreshKeyboardHook()
    {
        InstallKeyboardHook();
        if (context != null) context.SetEscapeHookAvailable(keyboardHook != IntPtr.Zero);
    }

    public static bool ApplyHighlightedCursor()
    {
        RestoreSystemCursors();
        IntPtr cursor = CreateHighlightedCursor();
        if (cursor == IntPtr.Zero) return false;
        bool applied = true;
        foreach (uint cursorId in HighlightedCursorIds)
        {
            IntPtr copy = CopyIcon(cursor);
            if (copy == IntPtr.Zero || !SetSystemCursor(copy, cursorId)) applied = false;
        }
        DestroyIcon(cursor);
        return applied;
    }

    public static void RestoreSystemCursors()
    {
        try { SystemParametersInfo(SpiSetCursors, 0, IntPtr.Zero, 0); } catch { }
    }

    private static IntPtr CreateHighlightedCursor()
    {
        using (Bitmap bitmap = new Bitmap(64, 64, PixelFormat.Format32bppArgb))
        using (Graphics graphics = Graphics.FromImage(bitmap))
        {
            graphics.SmoothingMode = SmoothingMode.AntiAlias;
            graphics.Clear(Color.Transparent);
            using (SolidBrush glow = new SolidBrush(Color.FromArgb(75, 14, 165, 233)))
            using (SolidBrush pointer = new SolidBrush(Color.FromArgb(250, 15, 23, 42)))
            using (Pen blueOutline = new Pen(Color.FromArgb(255, 56, 189, 248), 4f))
            using (Pen whiteOutline = new Pen(Color.FromArgb(255, 224, 242, 254), 1.5f))
            {
                graphics.FillEllipse(glow, 0, 0, 58, 58);
                Point[] points = new Point[] {
                    new Point(8, 5), new Point(9, 48), new Point(20, 37),
                    new Point(29, 57), new Point(39, 52), new Point(30, 34),
                    new Point(48, 34)
                };
                graphics.FillPolygon(pointer, points);
                graphics.DrawPolygon(blueOutline, points);
                graphics.DrawPolygon(whiteOutline, points);
            }

            IntPtr icon = bitmap.GetHicon();
            IconInfo info;
            if (!GetIconInfo(icon, out info))
            {
                DestroyIcon(icon);
                return IntPtr.Zero;
            }
            info.fIcon = false;
            info.xHotspot = 8;
            info.yHotspot = 5;
            IntPtr cursor = CreateIconIndirect(ref info);
            DeleteObject(info.hbmMask);
            DeleteObject(info.hbmColor);
            DestroyIcon(icon);
            return cursor;
        }
    }
}

public sealed class OverlayContext : ApplicationContext
{
    private readonly string commandDirectory;
    private readonly string statusPath;
    private readonly int parentPid;
    private readonly ControlBannerForm banner;
    private readonly Timer timer;
    private string lastStatus = "active";
    private DateTime nextHookRefresh = DateTime.UtcNow.AddSeconds(1);
    private readonly bool cursorHighlightEnabled;

    public OverlayContext(string agentName, string commandDirectory, string statusPath, int parentPid, bool showCursorHalo)
    {
        this.commandDirectory = commandDirectory;
        this.statusPath = statusPath;
        this.parentPid = parentPid;

        banner = new ControlBannerForm(agentName, WriteCommand);
        banner.FormClosed += delegate { ExitThread(); };
        banner.Show();

        cursorHighlightEnabled = showCursorHalo;
        if (cursorHighlightEnabled) ReflexOverlayHost.ApplyHighlightedCursor();

        timer = new Timer();
        timer.Interval = 32;
        timer.Tick += Tick;
        timer.Start();
        Tick(null, EventArgs.Empty);
    }

    public void SetEscapeHookAvailable(bool available)
    {
        banner.SetEscapeHookAvailable(available);
    }

    public void EmergencyStopFromEscape()
    {
        WriteCommand("emergency");
        if (banner.IsHandleCreated)
        {
            banner.BeginInvoke(new Action(delegate { banner.Close(); }));
        }
    }

    private void Tick(object sender, EventArgs e)
    {
        if (!ParentAlive())
        {
            banner.Close();
            return;
        }

        Point cursor = Cursor.Position;
        Screen screen = Screen.FromPoint(cursor);
        Rectangle area = screen.WorkingArea;
        banner.Location = new Point(area.Left + Math.Max(12, (area.Width - banner.Width) / 2), area.Top + 12);

        if (DateTime.UtcNow >= nextHookRefresh)
        {
            nextHookRefresh = DateTime.UtcNow.AddSeconds(1);
            ReflexOverlayHost.RefreshKeyboardHook();
        }

        try
        {
            if (File.Exists(statusPath))
            {
                string status = File.ReadAllText(statusPath).Trim().ToLowerInvariant();
                if (status == "closing")
                {
                    banner.Close();
                    return;
                }
                if ((status == "active" || status == "paused") && status != lastStatus)
                {
                    lastStatus = status;
                    banner.SetPaused(status == "paused");
                    if (cursorHighlightEnabled && status == "active") ReflexOverlayHost.ApplyHighlightedCursor();
                    else ReflexOverlayHost.RestoreSystemCursors();
                }
            }
        }
        catch { }
    }

    private bool ParentAlive()
    {
        if (parentPid <= 0) return true;
        try { return !Process.GetProcessById(parentPid).HasExited; }
        catch { return false; }
    }

    private void WriteCommand(string command)
    {
        try
        {
            Directory.CreateDirectory(commandDirectory);
            string name = DateTime.UtcNow.Ticks.ToString() + "-" + Guid.NewGuid().ToString("N") + ".cmd";
            File.WriteAllText(Path.Combine(commandDirectory, name), command);
        }
        catch { }

        if (command == "pause")
        {
            lastStatus = "paused";
            banner.SetPaused(true);
            ReflexOverlayHost.RestoreSystemCursors();
        }
        else if (command == "resume")
        {
            lastStatus = "active";
            banner.SetPaused(false);
            if (cursorHighlightEnabled) ReflexOverlayHost.ApplyHighlightedCursor();
        }
        else if (command == "release" || command == "emergency" || command == "exit")
        {
            banner.SetPending(command);
        }
    }

    protected override void ExitThreadCore()
    {
        if (timer != null)
        {
            timer.Stop();
            timer.Dispose();
        }
        ReflexOverlayHost.RestoreSystemCursors();
        if (banner != null && !banner.IsDisposed) banner.Dispose();
        base.ExitThreadCore();
    }
}

public sealed class ControlBannerForm : Form
{
    private readonly string agentName;
    private readonly Action<string> sendCommand;
    private readonly Label titleLabel;
    private readonly Label escapeLabel;
    private readonly Button pauseButton;
    private bool paused;

    public ControlBannerForm(string agentName, Action<string> sendCommand)
    {
        this.agentName = string.IsNullOrWhiteSpace(agentName) ? "AI" : agentName.Trim();
        this.sendCommand = sendCommand;

        Width = 980;
        Height = 58;
        Text = "Reflex AI control - " + this.agentName;
        AccessibleName = Text;
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        ShowInTaskbar = false;
        TopMost = true;
        BackColor = Color.FromArgb(15, 23, 42);
        ForeColor = Color.White;
        Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);
        Padding = new Padding(14, 8, 12, 8);

        titleLabel = new Label();
        titleLabel.AutoSize = false;
        titleLabel.Location = new Point(16, 7);
        titleLabel.Size = new Size(330, 23);
        titleLabel.Font = new Font("Segoe UI Semibold", 11f, FontStyle.Bold);
        titleLabel.ForeColor = Color.FromArgb(226, 232, 240);
        Controls.Add(titleLabel);

        escapeLabel = new Label();
        escapeLabel.AutoSize = false;
        escapeLabel.Location = new Point(17, 31);
        escapeLabel.Size = new Size(350, 18);
        escapeLabel.Font = new Font("Segoe UI", 8.5f, FontStyle.Regular);
        escapeLabel.ForeColor = Color.FromArgb(125, 211, 252);
        escapeLabel.Text = "Esc = emergency stop";
        Controls.Add(escapeLabel);

        pauseButton = MakeButton("Pause", 375, Color.FromArgb(30, 41, 59));
        pauseButton.Click += delegate { sendCommand(paused ? "resume" : "pause"); };
        Controls.Add(pauseButton);

        Button releaseButton = MakeButton("Release", 495, Color.FromArgb(30, 64, 54));
        releaseButton.Click += delegate { sendCommand("release"); };
        Controls.Add(releaseButton);

        Button stopButton = MakeButton("Emergency stop", 615, Color.FromArgb(127, 29, 29));
        stopButton.Width = 150;
        stopButton.Click += delegate { sendCommand("emergency"); };
        Controls.Add(stopButton);

        Button exitButton = MakeButton("Exit Reflex", 785, Color.FromArgb(88, 28, 135));
        exitButton.Width = 170;
        exitButton.Click += delegate { sendCommand("exit"); };
        Controls.Add(exitButton);

        SetPaused(false);
    }

    private Button MakeButton(string text, int x, Color backColor)
    {
        Button button = new Button();
        button.Text = text;
        button.AccessibleName = text;
        button.Location = new Point(x, 12);
        button.Size = new Size(112, 34);
        button.FlatStyle = FlatStyle.Flat;
        button.FlatAppearance.BorderColor = Color.FromArgb(71, 85, 105);
        button.FlatAppearance.BorderSize = 1;
        button.BackColor = backColor;
        button.ForeColor = Color.White;
        button.TabStop = true;
        button.Cursor = Cursors.Hand;
        return button;
    }

    public void SetPaused(bool isPaused)
    {
        paused = isPaused;
        titleLabel.Text = paused
            ? agentName + " control is paused"
            : agentName + " is using your computer";
        pauseButton.Text = paused ? "Resume" : "Pause";
        BackColor = paused ? Color.FromArgb(49, 46, 20) : Color.FromArgb(15, 23, 42);
        Invalidate();
    }

    public void SetEscapeHookAvailable(bool available)
    {
        escapeLabel.Text = available
            ? "Esc = emergency stop"
            : "Use Emergency stop (Esc hook unavailable)";
    }

    public void SetPending(string command)
    {
        titleLabel.Text = command == "emergency"
            ? "Emergency stop requested"
            : command == "exit"
                ? "Ending the Reflex process"
                : "Releasing " + agentName + " control";
        pauseButton.Enabled = false;
        escapeLabel.Text = "Reflex is applying the control change...";
        foreach (Control control in Controls)
        {
            Button button = control as Button;
            if (button != null) button.Enabled = false;
        }
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        using (Pen pen = new Pen(paused ? Color.FromArgb(250, 204, 21) : Color.FromArgb(56, 189, 248), 2f))
        {
            e.Graphics.DrawRectangle(pen, 1, 1, Width - 3, Height - 3);
        }
    }
}

'@

Add-Type -TypeDefinition $source -ReferencedAssemblies @(
    'System.Windows.Forms',
    'System.Drawing'
)

$agentName = if ($env:REFLEX_OVERLAY_AGENT) { $env:REFLEX_OVERLAY_AGENT } else { 'AI' }
$commandDirectory = $env:REFLEX_OVERLAY_COMMAND_DIR
$statusPath = $env:REFLEX_OVERLAY_STATUS_PATH
$parentPid = 0
[void][int]::TryParse($env:REFLEX_OVERLAY_PARENT_PID, [ref]$parentPid)
$showCursorHalo = $env:REFLEX_OVERLAY_CURSOR_HALO -ne '0'

try {
    [ReflexOverlayHost]::Run($agentName, $commandDirectory, $statusPath, $parentPid, $showCursorHalo)
}
finally {
    [ReflexOverlayHost]::RestoreSystemCursors()
}
