$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'WINDOWS_REQUIRED' }
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.Text = 'NTG Navi validation scratch - disposable'
$form.Width = 640
$form.Height = 240
$form.StartPosition = 'CenterScreen'
$label = New-Object System.Windows.Forms.Label
$label.Text = 'Type only into the empty field below. No files, network or submit action.'
$label.AutoSize = $true
$label.Left = 16
$label.Top = 20
$field = New-Object System.Windows.Forms.TextBox
$field.Name = 'NaviScratchInput'
$field.AccessibleName = 'Navi validation scratch input'
$field.Left = 16
$field.Top = 60
$field.Width = 580
$field.Height = 90
$field.Multiline = $true
$form.Controls.Add($label)
$form.Controls.Add($field)
[void]$form.ShowDialog()
$form.Dispose()
