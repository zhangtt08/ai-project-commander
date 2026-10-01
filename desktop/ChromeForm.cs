using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace AIProjectCommander.Desktop
{
    // 无边框窗口:WebView2 铺满整窗,标题栏完全由网页承担 ——
    // 侧栏品牌行与 topbar 声明 app-region: drag 即可拖拽(WebView2 非客户区支持),
    // 网页自绘三键经 postMessage 调窗口动作;边缘命中仍走 WndProc 保留系统级缩放。
    // 替代 Edge --app 模式窗口,让关闭/最大化等控制真正封装进软件内部。
    sealed class ChromeForm : Form
    {
        const int HTLEFT = 10;
        const int HTRIGHT = 11;
        const int HTTOP = 12;
        const int HTTOPLEFT = 13;
        const int HTTOPRIGHT = 14;
        const int HTBOTTOM = 15;
        const int HTBOTTOMLEFT = 16;
        const int HTBOTTOMRIGHT = 17;
        const int WM_NCHITTEST = 0x84;
        const int DWMWA_WINDOW_CORNER_PREFERENCE = 33;
        const int DWMWCP_ROUND = 2;

        readonly WebView2 view = new WebView2();

        public ChromeForm()
        {
            FormBorderStyle = FormBorderStyle.None;
            BackColor = Color.FromArgb(252, 252, 252);

            view.Dock = DockStyle.Fill;
            Controls.Add(view);

            try
            {
                int round = DWMWCP_ROUND;
                DwmSetWindowAttribute(Handle, DWMWA_WINDOW_CORNER_PREFERENCE, ref round, 4);
            }
            catch { }
        }

        // WebView2 运行库是否可用（同步判定，供调用方在降级前检测）。
        public static bool WebView2Available()
        {
            try
            {
                string v = CoreWebView2Environment.GetAvailableBrowserVersionString();
                return !string.IsNullOrEmpty(v);
            }
            catch { return false; }
        }

        public void ShowAndFocus()
        {
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            Show();
            Activate();
        }

        // 配置 WebView2:启用非客户区支持(app-region 生效),接线网页三键消息
        public void ConfigureWebView(string url, string userDataFolder)
        {
            Load += async delegate
            {
                try
                {
                    Directory.CreateDirectory(userDataFolder);
                    CoreWebView2Environment environment = await CoreWebView2Environment.CreateAsync(null, userDataFolder, null);
                    await view.EnsureCoreWebView2Async(environment);
                    view.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                    view.CoreWebView2.Settings.IsStatusBarEnabled = false;
                    view.CoreWebView2.Settings.IsNonClientRegionSupportEnabled = true;
                    view.CoreWebView2.NewWindowRequested += OnNewWindowRequested;
                    view.CoreWebView2.WebMessageReceived += OnWebMessage;
                    view.CoreWebView2.Navigate(url);
                }
                catch (Exception ex)
                {
                    MessageBox.Show(
                        "内嵌浏览器初始化失败：" + ex.Message +
                        "\n服务地址：" + url +
                        "\n\n可安装 WebView2 Runtime 后重试，或直接在浏览器打开服务地址。",
                        "AI Project Commander", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
            };
        }

        void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string msg = e.TryGetWebMessageAsString();
            if (msg == "window:minimize") WindowState = FormWindowState.Minimized;
            else if (msg == "window:toggle-maximize") ToggleMaximize();
            else if (msg == "window:close") Close();
        }

        void ToggleMaximize()
        {
            bool willMaximize = WindowState != FormWindowState.Maximized;
            if (willMaximize)
            {
                MaximizedBounds = Screen.FromControl(this).WorkingArea;
                WindowState = FormWindowState.Maximized;
            }
            else
            {
                WindowState = FormWindowState.Normal;
            }
            try
            {
                view.CoreWebView2.PostWebMessageAsString(willMaximize ? "window:maximized:true" : "window:maximized:false");
            }
            catch { }
        }

        static void OnNewWindowRequested(object sender, CoreWebView2NewWindowRequestedEventArgs e)
        {
            var deferral = e.GetDeferral();
            try { Process.Start(new ProcessStartInfo(e.Uri) { UseShellExecute = true }); } catch { }
            deferral.Complete();
            e.Handled = true;
        }

        protected override void OnActivated(EventArgs e)
        {
            base.OnActivated(e);
            try { MaximizedBounds = Screen.FromControl(this).WorkingArea; } catch { }
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WM_NCHITTEST && WindowState == FormWindowState.Normal)
            {
                int lx = (short)((long)m.LParam & 0xFFFF);
                int ly = (short)(((long)m.LParam >> 16) & 0xFFFF);
                Point p = PointToClient(new Point(lx, ly));
                int edge = 6;
                bool left = p.X <= edge;
                bool right = p.X >= ClientSize.Width - edge;
                bool top = p.Y <= edge;
                bool bottom = p.Y >= ClientSize.Height - edge;
                if (top && left) { m.Result = (IntPtr)HTTOPLEFT; return; }
                if (top && right) { m.Result = (IntPtr)HTTOPRIGHT; return; }
                if (bottom && left) { m.Result = (IntPtr)HTBOTTOMLEFT; return; }
                if (bottom && right) { m.Result = (IntPtr)HTBOTTOMRIGHT; return; }
                if (left) { m.Result = (IntPtr)HTLEFT; return; }
                if (right) { m.Result = (IntPtr)HTRIGHT; return; }
                if (top) { m.Result = (IntPtr)HTTOP; return; }
                if (bottom) { m.Result = (IntPtr)HTBOTTOM; return; }
            }
            base.WndProc(ref m);
        }

        [DllImport("dwmapi.dll")]
        static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
    }
}
