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
    // 无边框窗口 + 自绘标题栏（WebView2 壳）：三键内嵌、拖拽区返回 HTCAPTION（原生拖拽/贴靠/
    // 双击最大化）、边缘命中返回 HTLEFT..HTBOTTOMRIGHT（保留系统级缩放）。
    // 替代 Edge --app 模式窗口，让关闭/最大化等控制真正封装进软件内部。
    sealed class ChromeForm : Form
    {
        const int HTCAPTION = 2;
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

        readonly Panel titleBar;
        readonly Panel content;
        readonly Button maxButton;
        readonly WebView2 view = new WebView2();
        readonly Label status = new Label();
        string pendingUrl;
        string profileDir;

        public ChromeForm(string title, Icon icon)
        {
            Text = title;
            FormBorderStyle = FormBorderStyle.None;
            BackColor = Color.FromArgb(252, 252, 252);
            Font = new Font("Segoe UI", 9F);

            titleBar = new Panel();
            titleBar.Dock = DockStyle.Top;
            titleBar.Height = 36;
            titleBar.BackColor = Color.FromArgb(252, 252, 252);

            PictureBox pic = new PictureBox();
            pic.Size = new Size(18, 18);
            pic.Location = new Point(10, 9);
            pic.SizeMode = PictureBoxSizeMode.Zoom;
            try { if (icon != null) pic.Image = icon.ToBitmap(); } catch { }
            titleBar.Controls.Add(pic);

            Label label = new Label();
            label.Text = title;
            label.AutoSize = false;
            label.Size = new Size(360, 36);
            label.Location = new Point(34, 0);
            label.TextAlign = ContentAlignment.MiddleLeft;
            label.ForeColor = Color.FromArgb(22, 23, 28);
            titleBar.Controls.Add(label);

            Button closeButton = CaptionButton("\uE8BB", Color.FromArgb(207, 63, 79), Color.White);
            closeButton.Click += delegate { Close(); };
            maxButton = CaptionButton("\uE922", Color.FromArgb(227, 229, 235), Color.FromArgb(22, 23, 28));
            maxButton.Click += delegate { ToggleMaximize(); };
            Button minButton = CaptionButton("\uE921", Color.FromArgb(227, 229, 235), Color.FromArgb(22, 23, 28));
            minButton.Click += delegate { WindowState = FormWindowState.Minimized; };
            titleBar.Controls.Add(closeButton);
            titleBar.Controls.Add(maxButton);
            titleBar.Controls.Add(minButton);

            titleBar.Resize += delegate
            {
                closeButton.Left = titleBar.Width - 46;
                maxButton.Left = closeButton.Left - 46;
                minButton.Left = maxButton.Left - 46;
                label.Width = Math.Max(80, minButton.Left - label.Left - 8);
            };

            status.Dock = DockStyle.Fill;
            status.TextAlign = ContentAlignment.MiddleCenter;
            status.ForeColor = Color.FromArgb(90, 96, 110);
            status.Visible = false;

            view.Dock = DockStyle.Fill;
            view.Visible = false;

            content = new Panel();
            content.Dock = DockStyle.Fill;
            content.BackColor = Color.White;
            content.Controls.Add(view);
            content.Controls.Add(status);

            Controls.Add(content);
            Controls.Add(titleBar);

            try
            {
                int round = DWMWCP_ROUND;
                DwmSetWindowAttribute(Handle, DWMWA_WINDOW_CORNER_PREFERENCE, ref round, 4);
            }
            catch { }
        }

        public Panel ContentPanel { get { return content; } }

        public void ShowAndFocus()
        {
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            Show();
            Activate();
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

        public void AttachWebView(string url, string userDataFolder)
        {
            pendingUrl = url;
            profileDir = userDataFolder;
            Load += async delegate
            {
                try
                {
                    Directory.CreateDirectory(profileDir);
                    CoreWebView2Environment environment = await CoreWebView2Environment.CreateAsync(null, profileDir, null);
                    await view.EnsureCoreWebView2Async(environment);
                    view.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                    view.CoreWebView2.Settings.IsStatusBarEnabled = false;
                    view.CoreWebView2.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs e)
                    {
                        var deferral = e.GetDeferral();
                        try { Process.Start(new ProcessStartInfo(e.Uri) { UseShellExecute = true }); } catch { }
                        deferral.Complete();
                        e.Handled = true;
                    };
                    status.Visible = false;
                    view.Visible = true;
                    view.CoreWebView2.Navigate(pendingUrl);
                }
                catch (Exception ex)
                {
                    status.Visible = true;
                    status.Text = "内嵌浏览器初始化失败：" + ex.Message + "\n服务地址：" + pendingUrl;
                }
            };
        }

        static Button CaptionButton(string glyph, Color hoverBack, Color hoverFore)
        {
            Button b = new Button();
            b.Text = glyph;
            b.Font = new Font("Segoe MDL2 Assets", 9F);
            b.Size = new Size(46, 36);
            b.Dock = DockStyle.None;
            b.FlatStyle = FlatStyle.Flat;
            b.FlatAppearance.BorderSize = 0;
            b.FlatAppearance.MouseOverBackColor = hoverBack;
            b.ForeColor = Color.FromArgb(90, 96, 110);
            b.BackColor = Color.FromArgb(252, 252, 252);
            b.Tag = "caption-button";
            b.MouseEnter += delegate { b.ForeColor = hoverFore; };
            b.MouseLeave += delegate { b.ForeColor = Color.FromArgb(90, 96, 110); };
            return b;
        }

        void ToggleMaximize()
        {
            if (WindowState == FormWindowState.Maximized)
            {
                WindowState = FormWindowState.Normal;
                maxButton.Text = "\uE922";
            }
            else
            {
                MaximizedBounds = Screen.FromControl(this).WorkingArea;
                WindowState = FormWindowState.Maximized;
                maxButton.Text = "\uE923";
            }
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
                if (p.Y <= titleBar.Height && p.Y > edge)
                {
                    m.Result = (IntPtr)HTCAPTION;
                    return;
                }
            }
            base.WndProc(ref m);
        }

        [DllImport("dwmapi.dll")]
        static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
    }
}
