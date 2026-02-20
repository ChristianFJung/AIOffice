# VHS tape for AIOffice — full install flow

Output demo/demo.gif

Set FontSize 18
Set Width 900
Set Height 500
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Padding 20

# Setup PATH silently
Hide
Type "export PATH=$PWD/bin:$PATH"
Enter
Sleep 500ms
Type "clear"
Enter
Sleep 500ms
Show

# Simulate the install flow visually
Type "git clone https://github.com/christianfjung/aioffice"
Sleep 300ms
Enter

Hide
Sleep 500ms
Show

Sleep 300ms
Type "cd aioffice"
Sleep 200ms
Enter
Sleep 500ms

Type "npm i"
Sleep 200ms
Enter

Hide
Sleep 500ms
Show

Sleep 500ms

Type "officeagent demo"
Sleep 500ms
Enter
Sleep 12s
