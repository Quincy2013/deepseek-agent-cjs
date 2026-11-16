'use strict';
const { run } = require('./_utils');
const os = require('os');

async function listWindows() {
  if (os.platform() !== 'win32') {
    return 'Error: list_windows only supported on Windows';
  }
  try {
    // PowerShell script to get window titles and handles
    const ps = `
      Add-Type -Name WindowUtils -Namespace Win32 -MemberDefinition '
        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")]
        public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
        [DllImport("user32.dll")]
        public static extern bool GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
        [DllImport("user32.dll")]
        public static extern int GetWindowTextLength(IntPtr hWnd);
        [DllImport("user32.dll")]
        public static extern bool EnumWindows(System.IntPtr lpEnumFunc, System.IntPtr lParam);
        [DllImport("user32.dll")]
        public static extern bool IsWindowVisible(IntPtr hWnd);
      ';
      $windows = @();
      $callback = [System.IntPtr]::Zero;
      $enumFunc = [System.Runtime.InteropServices.Marshal]::GetFunctionPointerForDelegate(
        [System.IntPtr]([System.IntPtr], [System.IntPtr]) {
          param($hWnd, $lParam)
          if ([Win32.WindowUtils]::IsWindowVisible($hWnd)) {
            $length = [Win32.WindowUtils]::GetWindowTextLength($hWnd)
            if ($length -gt 0) {
              $sb = New-Object System.Text.StringBuilder ($length + 1)
              [Win32.WindowUtils]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
              $title = $sb.ToString()
              if ($title) {
                $windows += @{ Handle = $hWnd.ToInt32(); Title = $title }
              }
            }
          }
          return [System.IntPtr]::One
        }
      );
      [Win32.WindowUtils]::EnumWindows($enumFunc, [System.IntPtr]::Zero) | Out-Null
      $windows | Sort-Object Title | ForEach-Object { \"$($_.Handle): $($_.Title)\" }
    `;
    const r = await run('powershell', ['-NoProfile', '-Command', ps], { timeout: 15000 });
    const output = r.stdout.trim();
    return output ? output : 'No visible windows found';
  } catch (e) {
    return `List windows failed: ${e.message}`;
  }
}

async function activateWindow(target) {
  if (os.platform() !== 'win32') {
    return 'Error: activate_window only supported on Windows';
  }
  const t = (target || '').trim();
  if (!t) return 'Error: specify window handle or title';
  try {
    // Determine if target is a handle (number) or title
    const isHandle = /^\d+$/.test(t);
    let ps;
    if (isHandle) {
      // Activate by handle
      ps = `
        $handle = [IntPtr]::Parse("${t}");
        [Win32.WindowUtils]::SetForegroundWindow($handle) | Out-Null;
        Start-Sleep -Milliseconds 100;
        if ([Win32.WindowUtils]::GetForegroundWindow() -eq $handle) {
          \"Activated window handle: ${t}\"
        } else {
          \"Failed to activate window handle: ${t}\"
        }
      `;
      // Need to add SetForegroundWindow definition
      ps = `
        Add-Type -Name WindowUtils -Namespace Win32 -MemberDefinition '
          [DllImport("user32.dll")]
          public static extern bool SetForegroundWindow(IntPtr hWnd);
          [DllImport("user32.dll")]
          public static extern IntPtr GetForegroundWindow();
        ';
        $handle = [IntPtr]::Parse("${t}");
        $result = [Win32.WindowUtils]::SetForegroundWindow($handle);
        Start-Sleep -Milliseconds 100;
        $fg = [Win32.WindowUtils]::GetForegroundWindow();
        if ($result -and ($fg -eq $handle)) {
          \"Activated window handle: ${t}\"
        } else {
          \"Failed to activate window handle: ${t}\"
        }
      `;
    } else {
      // Activate by title (exact match first, then partial)
      ps = `
        Add-Type -Name WindowUtils -Namespace Win32 -MemberDefinition '
          [DllImport("user32.dll")]
          public static extern bool SetForegroundWindow(IntPtr hWnd);
          [DllImport("user32.dll")]
          public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
          [DllImport("user32.dll")]
          public static extern IntPtr GetForegroundWindow();
        ';
        $title = "${t}";
        $hWnd = [Win32.WindowUtils]::FindWindow($null, $title);
        if ($hWnd -eq [IntPtr]::Zero) {
          // Try partial match
          $windows = New-Object System.Collections.ArrayList
          $callback = [System.IntPtr]::Zero
          $enumFunc = [System.Runtime.InteropServices.Marshal]::GetFunctionPointerForDelegate(
            [System.IntPtr]([System.IntPtr], [System.IntPtr]) {
              param($hWnd, $lParam)
              if ([Win32.WindowUtils]::IsWindowVisible($hWnd)) {
                $length = [Win32.WindowUtils]::GetWindowTextLength($hWnd)
                if ($length -gt 0) {
                  $sb = New-Object System.Text.StringBuilder ($length + 1)
                  [Win32.WindowUtils]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
                  $title = $sb.ToString()
                  if ($title -and $title.Contains(\"${t}\")) {
                    $windows.Add($hWnd) | Out-Null
                  }
                }
              }
              return [System.IntPtr]::One
            }
          );
          [Win32.WindowUtils]::EnumWindows($enumFunc, [System.IntPtr]::Zero) | Out-Null
          if ($windows.Count -gt 0) {
            $hWnd = $windows[0]
          } else {
            $hWnd = [IntPtr]::Zero
          }
        }
        if ($hWnd -ne [IntPtr]::Zero) {
          $result = [Win32.WindowUtils]::SetForegroundWindow($hWnd);
          Start-Sleep -Milliseconds 100;
          $fg = [Win32.WindowUtils]::GetForegroundWindow();
          if ($result -and ($fg -eq $hWnd)) {
            \"Activated window title: ${t}\"
          } else {
            \"Failed to activate window title: ${t}\"
          }
        } else {
          \"Error: Window not found with title: ${t}\"
        }
      `;
    }
    const r = await run('powershell', ['-NoProfile', '-Command', ps], { timeout: 15000 });
    const output = r.stdout.trim();
    return output ? output : `Activate window failed: ${r.stderr}`;
  } catch (e) {
    return `Activate window failed: ${e.message}`;
  }
}

function registerTools(e) {
  e.registerTool('list_windows', listWindows, 'List visible windows (Windows only)');
  e.registerTool('activate_window', activateWindow, 'Activate window by handle or title (Windows only)');
}
module.exports = { registerTools };