$files = Get-ChildItem template
$sb = New-Object System.Text.StringBuilder
[void]$sb.Append("window.TEMPLATES_CONTENT = {`n")
foreach ($f in $files) {
    if ($f.Attributes -band [IO.FileAttributes]::Directory) { continue }
    $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($f.FullName))
    [void]$sb.Append("  '$($f.Name)': '$b64',`n")
}
[void]$sb.Append("};")
$sb.ToString() | Out-File -FilePath "templates_content.js" -Encoding utf8
