#!/usr/bin/env bash
# Read-only diagnostics for the Vizzy boot/wallpaper splash. Changes nothing.
# Run on the Pi (no sudo needed) and paste the whole output back:
#   bash deploy/splash-diagnose.sh
echo "==================== VIZZY SPLASH DIAGNOSTICS ===================="
echo

echo "--- OS / model ---"
grep -E 'PRETTY_NAME' /etc/os-release 2>/dev/null | cut -d= -f2
tr -d '\0' < /proc/device-tree/model 2>/dev/null; echo
echo

echo "--- Plymouth ---"
echo "installed: $(command -v plymouthd || echo NO)"
echo "active theme: $(plymouth-set-default-theme 2>/dev/null || echo '(cannot read)')"
echo "default.plymouth -> $(readlink -f /etc/alternatives/default.plymouth 2>/dev/null || echo none)"
echo "themes available: $(ls /usr/share/plymouth/themes 2>/dev/null | tr '\n' ' ')"
echo "pix splash.png: $(ls -la /usr/share/plymouth/themes/pix/splash.png 2>/dev/null || echo missing)"
echo "our backup present: $(ls /usr/share/plymouth/themes/pix/splash.png.vizzy-orig 2>/dev/null && echo yes || echo no)"
echo "vizzy image installed: $(ls -la /usr/share/vizzy/vizzy-splash.png 2>/dev/null || echo missing)"
echo

echo "--- initramfs (decides if theme changes need -R / update-initramfs) ---"
ls -la /boot/firmware/initramfs* /boot/initramfs* 2>/dev/null || echo "no initramfs image found"
grep -iE 'initramfs|auto_initramfs' /boot/firmware/config.txt /boot/config.txt 2>/dev/null || echo "no initramfs line in config.txt"
echo

echo "--- boot config ---"
BOOT=/boot/firmware; [ -d "$BOOT" ] || BOOT=/boot
echo "boot dir: $BOOT"
echo "cmdline.txt:"; cat "$BOOT/cmdline.txt" 2>/dev/null
echo "config.txt splash lines:"; grep -inE 'splash|disable_overscan|display_' "$BOOT/config.txt" 2>/dev/null || echo "(none)"
echo

echo "--- desktop session / compositor (for the wallpaper) ---"
echo "XDG_SESSION_TYPE=${XDG_SESSION_TYPE:-?}   XDG_CURRENT_DESKTOP=${XDG_CURRENT_DESKTOP:-?}"
echo "running compositor:"
pgrep -a -x wayfire 2>/dev/null || true
pgrep -a -x labwc 2>/dev/null || true
pgrep -a -x Xorg 2>/dev/null || true
pgrep -a -x lxsession 2>/dev/null || true
echo "wallpaper tools: swaybg=$(command -v swaybg || echo no)  feh=$(command -v feh || echo no)  pcmanfm=$(command -v pcmanfm || echo no)"
echo "wayfire.ini: $([ -f "$HOME/.config/wayfire.ini" ] && echo present || echo none)"
echo "labwc dir:   $([ -d "$HOME/.config/labwc" ] && echo present || echo none)"
echo

echo "--- current display resolution ---"
if command -v wlr-randr >/dev/null 2>&1; then wlr-randr 2>/dev/null | grep -iE 'current|Output' | head; \
elif command -v xrandr >/dev/null 2>&1; then xrandr 2>/dev/null | grep -iE '\*|connected' | head; \
else cat /sys/class/graphics/fb0/virtual_size 2>/dev/null; fi
echo

echo "--- kiosk autostart ---"
ls -la "$HOME/.config/autostart/vizzy-kiosk.desktop" 2>/dev/null || echo "no autostart entry"
echo "=================================================================="
