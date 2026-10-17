# jev-cu-win UI Automation host.
#
# Reads one JSON request per line on stdin and writes one JSON response per line
# on stdout:  {"id":1,"cmd":"observe","args":{}}  ->  {"id":1,"ok":true,"result":{...}}
#
# Runs on Windows PowerShell 5.1 (built into Windows 10/11) and PowerShell 7.
# Keep this file ASCII-only: Windows PowerShell 5.1 reads BOM-less scripts in the
# system ANSI code page, so non-ASCII literals would be corrupted.

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

# C# 5 only (Windows PowerShell 5.1 compiles with the old CodeDom compiler).
Add-Type -TypeDefinition @'
using System;
using System.Threading;
using System.Runtime.InteropServices;

public static class JevInput {
    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Explicit)]
    struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)]
    struct INPUT { public uint type; public InputUnion u; }

    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int cmd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr processId);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
    const uint KEYEVENTF_EXTENDEDKEY = 0x1, KEYEVENTF_KEYUP = 0x2, KEYEVENTF_UNICODE = 0x4;
    const uint MOUSEEVENTF_MOVE = 0x1, MOUSEEVENTF_WHEEL = 0x800, MOUSEEVENTF_HWHEEL = 0x1000;

    public static void MakeDpiAware() {
        // Per-monitor v2 so UIA bounding rectangles and SetCursorPos agree on scaled displays.
        try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; } catch (EntryPointNotFoundException) { }
        try { SetProcessDPIAware(); } catch (EntryPointNotFoundException) { }
    }

    static void Send(INPUT[] inputs) {
        if (SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT))) != inputs.Length)
            throw new InvalidOperationException("SendInput failed (error " + Marshal.GetLastWin32Error() + "). An elevated window cannot be controlled from a non-elevated process.");
    }

    static INPUT Mouse(uint flags, uint data) {
        INPUT i = new INPUT(); i.type = INPUT_MOUSE; i.u.mi.dwFlags = flags; i.u.mi.mouseData = data; return i;
    }

    static INPUT Key(ushort vk, ushort scan, uint flags) {
        INPUT i = new INPUT(); i.type = INPUT_KEYBOARD; i.u.ki.wVk = vk; i.u.ki.wScan = scan; i.u.ki.dwFlags = flags; return i;
    }

    public static void Activate(IntPtr hwnd) {
        if (hwnd == IntPtr.Zero) return;
        if (IsIconic(hwnd)) { ShowWindow(hwnd, 9); Thread.Sleep(150); } // SW_RESTORE
        if (GetForegroundWindow() == hwnd) return;
        // A zero-distance mouse move makes this process the source of the last input event,
        // which lets it take the foreground. Do not tap Alt for this: in apps with a menu bar
        // (Notepad) Alt activates the menu and the following keystrokes become menu shortcuts.
        Send(new INPUT[] { Mouse(MOUSEEVENTF_MOVE, 0) });
        if (!SetForegroundWindow(hwnd)) {
            uint fg = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
            uint me = GetCurrentThreadId();
            if (fg != 0 && fg != me && AttachThreadInput(me, fg, true)) {
                BringWindowToTop(hwnd);
                SetForegroundWindow(hwnd);
                AttachThreadInput(me, fg, false);
            }
        }
        Thread.Sleep(80);
    }

    static uint DownFlag(string button) { return button == "right" ? 0x8u : button == "middle" ? 0x20u : 0x2u; }
    static uint UpFlag(string button) { return button == "right" ? 0x10u : button == "middle" ? 0x40u : 0x4u; }

    public static void Click(int x, int y, string button, int count) {
        SetCursorPos(x, y);
        Thread.Sleep(30);
        for (int n = 0; n < count; n++) {
            Send(new INPUT[] { Mouse(DownFlag(button), 0), Mouse(UpFlag(button), 0) });
            Thread.Sleep(40);
        }
    }

    public static void Drag(int x1, int y1, int x2, int y2) {
        SetCursorPos(x1, y1);
        Thread.Sleep(30);
        Send(new INPUT[] { Mouse(DownFlag("left"), 0) });
        const int steps = 12;
        for (int s = 1; s <= steps; s++) {
            SetCursorPos(x1 + (x2 - x1) * s / steps, y1 + (y2 - y1) * s / steps);
            Send(new INPUT[] { Mouse(MOUSEEVENTF_MOVE, 0) });
            Thread.Sleep(15);
        }
        Send(new INPUT[] { Mouse(UpFlag("left"), 0) });
    }

    public static void Wheel(int x, int y, int delta, bool horizontal) {
        SetCursorPos(x, y);
        Thread.Sleep(30);
        Send(new INPUT[] { Mouse(horizontal ? MOUSEEVENTF_HWHEEL : MOUSEEVENTF_WHEEL, unchecked((uint)delta)) });
    }

    static bool IsExtended(ushort vk) {
        return (vk >= 0x21 && vk <= 0x2E) || vk == 0x5B || vk == 0x5C || vk == 0x6F || vk == 0xA3 || vk == 0xA5;
    }

    public static void Keys(ushort[] vks) {
        INPUT[] inputs = new INPUT[vks.Length * 2];
        for (int k = 0; k < vks.Length; k++) {
            uint ext = IsExtended(vks[k]) ? KEYEVENTF_EXTENDEDKEY : 0;
            inputs[k] = Key(vks[k], 0, ext);
            inputs[inputs.Length - 1 - k] = Key(vks[k], 0, ext | KEYEVENTF_KEYUP);
        }
        Send(inputs);
    }

    // Paced on purpose: Windows 11 Notepad drops Enter presses that arrive in a burst of
    // characters, which joined lines together.
    public static void TypeUnicode(string text) {
        foreach (char c in text) {
            if (c == '\r') continue;
            if (c == '\n') { Keys(new ushort[] { 0x0D }); Thread.Sleep(40); continue; }
            if (c == '\t') { Keys(new ushort[] { 0x09 }); Thread.Sleep(15); continue; }
            Send(new INPUT[] { Key(0, c, KEYEVENTF_UNICODE), Key(0, c, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP) });
            Thread.Sleep(4);
        }
    }
}
'@

[JevInput]::MakeDpiAware()

$AE = [System.Windows.Automation.AutomationElement]
$Walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker

$script:Window = $null
$script:AppName = $null
$script:Elements = New-Object System.Collections.ArrayList

$RoleMap = @{
    'Button' = 'button'; 'Calendar' = 'calendar'; 'CheckBox' = 'checkbox'; 'ComboBox' = 'combo box'
    'Custom' = 'container'; 'DataGrid' = 'grid'; 'DataItem' = 'data item'; 'Document' = 'document'
    'Edit' = 'text field'; 'Group' = 'group'; 'Header' = 'header'; 'HeaderItem' = 'header item'
    'Hyperlink' = 'link'; 'Image' = 'image'; 'List' = 'list view'; 'ListItem' = 'list item'
    'Menu' = 'menu'; 'MenuBar' = 'menu bar'; 'MenuItem' = 'menu item'; 'Pane' = 'pane'
    'ProgressBar' = 'progress bar'; 'RadioButton' = 'radio button'; 'ScrollBar' = 'scroll bar'
    'SemanticZoom' = 'container'; 'Separator' = 'separator'; 'Slider' = 'slider'; 'Spinner' = 'stepper'
    'SplitButton' = 'split button'; 'StatusBar' = 'status bar'; 'Tab' = 'tab list'; 'TabItem' = 'tab'
    'Table' = 'grid'; 'Text' = 'text'; 'Thumb' = 'thumb'; 'TitleBar' = 'title bar'; 'ToolBar' = 'toolbar'
    'ToolTip' = 'tooltip'; 'Tree' = 'tree'; 'TreeItem' = 'tree item'; 'Window' = 'window'
}
# Pure noise for choosing what to click; their subtrees are skipped as well.
$SkipTypes = @('ScrollBar', 'Thumb', 'Separator')
$ValueTypes = @('Edit', 'ComboBox', 'Spinner', 'DataItem')
$SearchJa = [string][char]0x691C + [char]0x7D22 # "kensaku" (search) in Japanese

# Edge puts a zero-width space in its title ("Microsoft<U+200B> Edge"). Drop invisible
# format characters and non-breaking spaces so names match what the user types.
function Normalize-Text([string]$s) {
    if ($null -eq $s) { return '' }
    return (($s -replace '\p{Cf}', '') -replace '\u00A0', ' ')
}

function Clean([string]$s, [int]$max = 160) {
    if ($null -eq $s) { return '' }
    $s = ((Normalize-Text $s) -replace '[\r\n\t]+', ' ').Trim()
    if ($s.Length -gt $max) { $s = $s.Substring(0, $max) + '...' }
    return $s
}

function Get-ProcName([int]$procId) {
    try { return (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { return '' }
}

function Get-Pattern($el, $pattern) {
    $p = $null
    if ($el.TryGetCurrentPattern($pattern, [ref]$p)) { return $p }
    return $null
}

# Elements read by Cmd-Observe carry a cache of the properties below, filled by one
# cross-process call for the whole tree. Reading .Current instead costs one call per
# property per element, which made a Chrome page take ~0.5 s to observe.
$ObserveCache = New-Object System.Windows.Automation.CacheRequest
$ObserveCache.TreeFilter = [System.Windows.Automation.Automation]::ControlViewCondition
$ObserveCache.TreeScope = [System.Windows.Automation.TreeScope]::Subtree
foreach ($prop in @($AE::ControlTypeProperty, $AE::NameProperty, $AE::AutomationIdProperty, $AE::IsOffscreenProperty,
        $AE::IsEnabledProperty, $AE::IsPasswordProperty, [System.Windows.Automation.ValuePattern]::ValueProperty)) {
    $ObserveCache.Add($prop)
}
$ObserveCache.Add([System.Windows.Automation.ValuePattern]::Pattern)

# Cached properties when the element came from Cmd-Observe, live ones otherwise.
function Get-Info($el) {
    try { return $el.Cached } catch { return $el.Current }
}

function Get-TypeName($el) {
    return ((Get-Info $el).ControlType.ProgrammaticName -replace '^ControlType\.', '')
}

function Get-Role($el, [string]$type, [int]$depth) {
    if ($depth -eq 0) { return 'standard window' }
    $role = $RoleMap[$type]
    if (-not $role) { $role = 'container' }
    if ($type -eq 'Edit') {
        $c = Get-Info $el
        $hint = '' + $c.Name + ' ' + $c.AutomationId
        if ($hint -match '(?i)search|find' -or $hint.Contains($SearchJa)) { $role = 'search field' }
    }
    return $role
}

function Get-Value($el) {
    try {
        $v = $el.GetCachedPropertyValue([System.Windows.Automation.ValuePattern]::ValueProperty)
        if ([object]::ReferenceEquals($v, $AE::NotSupported)) { return $null }
        return '' + $v
    } catch { }
    $vp = Get-Pattern $el ([System.Windows.Automation.ValuePattern]::Pattern)
    if ($vp) { return $vp.Current.Value }
    return $null
}

function Get-Label($el, [string]$type) {
    $c = Get-Info $el
    $name = Clean $c.Name
    $parts = New-Object System.Collections.ArrayList
    if ($name) { [void]$parts.Add($name) }
    $value = $null
    if (-not $c.IsPassword) {
        if ($ValueTypes -contains $type) {
            $value = Get-Value $el
        } elseif ($type -eq 'Document') {
            $tp = Get-Pattern $el ([System.Windows.Automation.TextPattern]::Pattern)
            if ($tp) { $value = $tp.DocumentRange.GetText(300) }
        }
    }
    $value = Clean $value 200
    if ($value -and $value -ne $name) { [void]$parts.Add('Value: ' + $value) }
    $autoId = '' + $c.AutomationId
    # Numeric AutomationIds are Win32 control ids / runtime ids and carry no meaning.
    if ($autoId -and $autoId -notmatch '^[\d\-\.]+$') { [void]$parts.Add('ID: ' + (Clean $autoId 60)) }
    $label = $parts -join ', '
    if (-not $c.IsEnabled) { $label = ($label + ' (disabled)').Trim() }
    return $label
}

# Top-level windows with their titles and process ids fetched in one call.
$WindowCache = New-Object System.Windows.Automation.CacheRequest
$WindowCache.Add($AE::NameProperty)
$WindowCache.Add($AE::ProcessIdProperty)

function Find-Window([string]$app) {
    $root = $AE::RootElement
    $act = $WindowCache.Activate()
    try { $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition) }
    finally { $act.Dispose() }
    # One process snapshot instead of a Get-Process call per window.
    $procNames = @{}
    foreach ($p in [System.Diagnostics.Process]::GetProcesses()) { $procNames[$p.Id] = $p.ProcessName }
    $best = $null; $bestScore = 0
    $app = (Normalize-Text $app).Trim()
    foreach ($w in $wins) {
        try {
            $title = Normalize-Text $w.Cached.Name
            $proc = '' + $procNames[$w.Cached.ProcessId]
        } catch { continue }
        # The terminal running this tool shows our own command line ("... cli.mjs observe --app X")
        # in its title, so a partial title match would bind to the terminal itself.
        if ($title -match '(?i)cli\.mjs') { continue }
        $score = 0
        if ($title -ieq $app) { $score = 4 }
        elseif ($proc -ieq $app -or ($proc + '.exe') -ieq $app) { $score = 3 }
        elseif ($title.IndexOf($app, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $score = 2 }
        if ($score -gt $bestScore) { $best = $w; $bestScore = $score }
    }
    return $best
}

function Cmd-ListWindows {
    $root = $AE::RootElement
    $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    $list = New-Object System.Collections.ArrayList
    foreach ($w in $wins) {
        try {
            $title = Normalize-Text $w.Current.Name
            if (-not $title) { continue }
            [void]$list.Add(@{ title = $title; process = (Get-ProcName $w.Current.ProcessId); pid = $w.Current.ProcessId })
        } catch { }
    }
    return @{ windows = @($list) }
}

function Cmd-Bind($a) {
    $app = '' + $a.app
    if (-not $app) { throw 'app is required' }
    $w = Find-Window $app
    if (-not $w) { throw ('window not found: "' + $app + '". Open the app first, or run the "windows" command to see window titles.') }
    $script:Window = $w
    $script:AppName = $app
    $script:Elements.Clear()
    return @{ title = $w.Current.Name; process = (Get-ProcName $w.Current.ProcessId); pid = $w.Current.ProcessId }
}

function Assert-Bound {
    if (-not $script:Window) { throw 'no window bound; call bind first' }
    try { [void]$script:Window.Current.Name } catch {
        $w = Find-Window $script:AppName
        if (-not $w) { throw ('window "' + $script:AppName + '" was closed') }
        $script:Window = $w
    }
}

function Cmd-Observe($a) {
    Assert-Bound
    $maxNodes = 1500; if ($a.maxNodes) { $maxNodes = [int]$a.maxNodes }
    $maxDepth = 40; if ($a.maxDepth) { $maxDepth = [int]$a.maxDepth }
    $script:Elements.Clear()
    $sb = New-Object System.Text.StringBuilder
    $title = Clean $script:Window.Current.Name
    $proc = Get-ProcName $script:Window.Current.ProcessId
    [void]$sb.AppendLine('Window: "' + $title + '", App: ' + $proc + '.')
    $script:Truncated = $false

    $root = $script:Window.GetUpdatedCache($ObserveCache)
    $stack = New-Object System.Collections.Stack
    $stack.Push(@($root, 0))
    while ($stack.Count -gt 0) {
        $item = $stack.Pop(); $el = $item[0]; $depth = $item[1]
        if ($script:Elements.Count -ge $maxNodes) { $script:Truncated = $true; break }
        try {
            $type = Get-TypeName $el
            if ($SkipTypes -contains $type) { continue }
            $emit = ($depth -eq 0) -or (-not $el.Cached.IsOffscreen)
            if ($emit) {
                $index = $script:Elements.Add($el)
                $line = ("`t" * $depth) + $index + ' ' + (Get-Role $el $type $depth) + ' ' + (Get-Label $el $type)
                [void]$sb.AppendLine($line.TrimEnd())
            }
        } catch { continue }
        if ($depth -ge $maxDepth) { continue }
        # Push children in reverse so they pop in document order.
        $children = $null
        try { $children = $el.CachedChildren } catch { }
        if ($null -eq $children) { continue }
        for ($k = $children.Count - 1; $k -ge 0; $k--) { $stack.Push(@($children[$k], ($depth + 1))) }
    }
    if ($script:Truncated) { [void]$sb.AppendLine('(tree truncated at ' + $maxNodes + ' elements)') }

    try {
        $focused = $AE::FocusedElement
        if ($focused) {
            for ($k = 0; $k -lt $script:Elements.Count; $k++) {
                if ([System.Windows.Automation.Automation]::Compare($focused, $script:Elements[$k])) {
                    $f = $script:Elements[$k]; $ft = Get-TypeName $f
                    [void]$sb.AppendLine('The focused UI element is ' + $k + ' ' + (Get-Role $f $ft 1) + ' ' + (Get-Label $f $ft))
                    break
                }
            }
        }
    } catch { }
    return @{ text = $sb.ToString(); count = $script:Elements.Count; truncated = $script:Truncated }
}

function Get-Element($index) {
    Assert-Bound
    $i = [int]$index
    if ($i -lt 0 -or $i -ge $script:Elements.Count) { throw ('element ' + $i + ' not found; observe again') }
    return $script:Elements[$i]
}

function Activate-Window {
    [JevInput]::Activate([IntPtr]$script:Window.Current.NativeWindowHandle)
}

function Get-Point($el) {
    try { $p = $el.GetClickablePoint(); return @([int]$p.X, [int]$p.Y) } catch { }
    $r = $el.Current.BoundingRectangle
    if ($r.IsEmpty -or [double]::IsInfinity($r.Width)) { throw 'element has no on-screen position' }
    return @([int]($r.Left + $r.Width / 2), [int]($r.Top + $r.Height / 2))
}

function To-Screen($xy) {
    $r = $script:Window.Current.BoundingRectangle
    return @([int]($r.Left + [double]$xy[0]), [int]($r.Top + [double]$xy[1]))
}

function Cmd-Click($a) {
    $el = Get-Element $a.index
    $button = 'left'; if ($a.button) { $button = '' + $a.button }
    $type = Get-TypeName $el
    Activate-Window
    if ($button -eq 'left' -and @('Edit', 'Document') -notcontains $type) {
        $p = Get-Pattern $el ([System.Windows.Automation.InvokePattern]::Pattern)
        if ($p) { $p.Invoke(); return @{ method = 'invoke' } }
        $p = Get-Pattern $el ([System.Windows.Automation.TogglePattern]::Pattern)
        if ($p) { $p.Toggle(); return @{ method = 'toggle' } }
        $p = Get-Pattern $el ([System.Windows.Automation.SelectionItemPattern]::Pattern)
        if ($p) { $p.Select(); return @{ method = 'select' } }
        $p = Get-Pattern $el ([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
        if ($p) {
            if ($p.Current.ExpandCollapseState -eq [System.Windows.Automation.ExpandCollapseState]::Expanded) { $p.Collapse() } else { $p.Expand() }
            return @{ method = 'expand-collapse' }
        }
    }
    try { $el.SetFocus() } catch { }
    $xy = Get-Point $el
    [JevInput]::Click($xy[0], $xy[1], $button, 1)
    return @{ method = 'mouse'; x = $xy[0]; y = $xy[1] }
}

function Cmd-ClickAt($a) {
    Assert-Bound
    Activate-Window
    $xy = To-Screen @($a.x, $a.y)
    $button = 'left'; if ($a.button) { $button = '' + $a.button }
    [JevInput]::Click($xy[0], $xy[1], $button, 1)
    return @{ method = 'mouse'; x = $xy[0]; y = $xy[1] }
}

function Cmd-Drag($a) {
    Assert-Bound
    Activate-Window
    $from = To-Screen $a.from
    $to = To-Screen $a.to
    [JevInput]::Drag($from[0], $from[1], $to[0], $to[1])
    return @{ method = 'mouse' }
}

function Cmd-SetValue($a) {
    $el = Get-Element $a.index
    $text = '' + $a.text
    $vp = Get-Pattern $el ([System.Windows.Automation.ValuePattern]::Pattern)
    if ($vp -and -not $vp.Current.IsReadOnly) {
        $vp.SetValue($text)
        return @{ method = 'value-pattern' }
    }
    Activate-Window
    try { $el.SetFocus() } catch { }
    [JevInput]::Keys([uint16[]]@(0x11, 0x41)) # Ctrl+A
    [JevInput]::TypeUnicode($text)
    return @{ method = 'keyboard' }
}

function Cmd-TypeText($a) {
    Assert-Bound
    Activate-Window
    [JevInput]::TypeUnicode('' + $a.text)
    return @{ method = 'keyboard' }
}

$KeyNames = @{
    'ctrl' = 0x11; 'control' = 0x11; 'shift' = 0x10; 'alt' = 0x12; 'win' = 0x5B; 'cmd' = 0x11
    'enter' = 0x0D; 'return' = 0x0D; 'tab' = 0x09; 'escape' = 0x1B; 'esc' = 0x1B; 'space' = 0x20
    'backspace' = 0x08; 'delete' = 0x2E; 'del' = 0x2E; 'insert' = 0x2D
    'up' = 0x26; 'down' = 0x28; 'left' = 0x25; 'right' = 0x27
    'arrowup' = 0x26; 'arrowdown' = 0x28; 'arrowleft' = 0x25; 'arrowright' = 0x27
    'home' = 0x24; 'end' = 0x23; 'pageup' = 0x21; 'pagedown' = 0x22
    'plus' = 0xBB; 'minus' = 0xBD; 'add' = 0x6B; 'subtract' = 0x6D; 'multiply' = 0x6A; 'divide' = 0x6F
}

function Get-Vk([string]$name) {
    $n = $name.Trim().ToLowerInvariant()
    if ($KeyNames.ContainsKey($n)) { return [uint16]$KeyNames[$n] }
    if ($n -match '^f([1-9]|1[0-9]|2[0-4])$') { return [uint16](0x6F + [int]$Matches[1]) }
    if ($n -match '^[a-z0-9]$') { return [uint16][int][char]$n.ToUpperInvariant() }
    throw ('unknown key: ' + $name)
}

function Cmd-PressKey($a) {
    Assert-Bound
    $key = '' + $a.key
    if (-not $key) { throw 'key is required' }
    # "+" alone is a key, otherwise it joins a combo such as ctrl+shift+s.
    if ($key -eq '+') { $names = @('plus') } else { $names = $key -split '\+' }
    $vks = @(); foreach ($n in $names) { $vks += (Get-Vk $n) }
    Activate-Window
    [JevInput]::Keys([uint16[]]$vks)
    return @{ method = 'keyboard' }
}

function Cmd-Scroll($a) {
    $el = Get-Element $a.index
    $direction = 'down'; if ($a.direction) { $direction = ('' + $a.direction).ToLowerInvariant() }
    $pages = 1; if ($a.pages) { $pages = [int]$a.pages }
    $horizontal = @('left', 'right') -contains $direction
    $forward = @('down', 'right') -contains $direction

    $node = $el
    while ($null -ne $node) {
        $sp = Get-Pattern $node ([System.Windows.Automation.ScrollPattern]::Pattern)
        $can = $false
        if ($sp) { if ($horizontal) { $can = $sp.Current.HorizontallyScrollable } else { $can = $sp.Current.VerticallyScrollable } }
        if ($can) {
            $amount = [System.Windows.Automation.ScrollAmount]::LargeDecrement
            if ($forward) { $amount = [System.Windows.Automation.ScrollAmount]::LargeIncrement }
            for ($k = 0; $k -lt $pages; $k++) {
                if ($horizontal) { $sp.ScrollHorizontal($amount) } else { $sp.ScrollVertical($amount) }
            }
            return @{ method = 'scroll-pattern' }
        }
        if ([System.Windows.Automation.Automation]::Compare($node, $script:Window)) { break }
        $node = $Walker.GetParent($node)
    }
    Activate-Window
    $xy = Get-Point $el
    $delta = 360 * $pages
    # Wheel: positive scrolls up; horizontal wheel: positive scrolls right.
    if ($horizontal) { if (-not $forward) { $delta = -$delta } } else { if ($forward) { $delta = -$delta } }
    [JevInput]::Wheel($xy[0], $xy[1], $delta, $horizontal)
    return @{ method = 'wheel' }
}

function Invoke-Request([string]$cmd, $a) {
    switch ($cmd) {
        'ping' { return @{ pong = $true; ps = $PSVersionTable.PSVersion.ToString() } }
        'windows' { return Cmd-ListWindows }
        'bind' { return Cmd-Bind $a }
        'observe' { return Cmd-Observe $a }
        'click' { return Cmd-Click $a }
        'clickAt' { return Cmd-ClickAt $a }
        'drag' { return Cmd-Drag $a }
        'setValue' { return Cmd-SetValue $a }
        'typeText' { return Cmd-TypeText $a }
        'pressKey' { return Cmd-PressKey $a }
        'scroll' { return Cmd-Scroll $a }
        default { throw ('unknown command: ' + $cmd) }
    }
}

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if (-not $line.Trim()) { continue }
    $id = $null
    try {
        $req = $line | ConvertFrom-Json
        $id = $req.id
        $result = Invoke-Request ('' + $req.cmd) $req.args
        $resp = @{ id = $id; ok = $true; result = $result }
    } catch {
        $resp = @{ id = $id; ok = $false; error = $_.Exception.Message }
    }
    [Console]::Out.WriteLine(($resp | ConvertTo-Json -Compress -Depth 6))
    [Console]::Out.Flush()
}
