import { execFile } from 'node:child_process';
import { PRODUCT_NAME } from '../../../../packages/shared/src/brand.js';

/**
 * Send a Windows toast notification via PowerShell.
 * Fire-and-forget: does not await, logs errors silently.
 */
export function sendWindowsNotification(title: string, body: string): void {
  // Escape single quotes for PowerShell string
  const escapedTitle = title.replace(/'/g, "''");
  const escapedBody = body.replace(/'/g, "''");

  const script = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null

$template = @"
<toast>
  <visual>
    <binding template="ToastGeneric">
      <text>${escapedTitle}</text>
      <text>${escapedBody}</text>
    </binding>
  </visual>
</toast>
"@

$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml($template)
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${PRODUCT_NAME}')
$notifier.Show($toast)
`;

  execFile('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    script,
  ], { timeout: 10000 }, (err) => {
    if (err) {
      // Fallback: try simpler BurntToast or basic notification
      sendFallbackNotification(title, body);
    }
  });
}

/**
 * Fallback notification using a simpler PowerShell approach.
 */
function sendFallbackNotification(title: string, body: string): void {
  const escapedTitle = title.replace(/'/g, "''");
  const escapedBody = body.replace(/'/g, "''");

  // Try using .NET balloon tip as fallback
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Information
$notify.Visible = $true
$notify.BalloonTipTitle = '${escapedTitle}'
$notify.BalloonTipText = '${escapedBody}'
$notify.ShowBalloonTip(5000)
Start-Sleep -Seconds 6
$notify.Dispose()
`;

  execFile('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    script,
  ], { timeout: 15000 }, (err) => {
    if (err) {
      console.error('[notifications] Windows notification error:', err.message);
    }
  });
}
