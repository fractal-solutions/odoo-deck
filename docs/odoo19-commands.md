# Odoo 19 Local Instance - Command Reference

- **DB:** `fractal_odoo_19`
- **Service:** `odoo-server-19.0`
- **Install:** `C:\Program Files\Odoo 19.0e.20260702`
- **Log:** `C:\Program Files\Odoo 19.0e.20260702\server\odoo.log`

> Run PowerShell as **Administrator**.

## 0) One-time setup (paste at top of each PowerShell session)

```powershell
$py     = "C:\Program Files\Odoo 19.0e.20260702\python\python.exe"
$bin    = "C:\Program Files\Odoo 19.0e.20260702\server\odoo-bin"
$cfg    = "C:\Program Files\Odoo 19.0e.20260702\server\odoo.conf"
$log    = "C:\Program Files\Odoo 19.0e.20260702\server\odoo.log"
$src    = "C:\dev\Woocommerce\custom"
$dest   = "C:\Program Files\Odoo 19.0e.20260702\server\odoo\addons"
$db     = "fractal_odoo_19"
```

## 1) Stream logs (live tail)

```powershell
Get-Content $log -Tail 50 -Wait
```

## 2) Copy changed modules from repo to Odoo (no deletion)

```powershell
robocopy $src $dest /E /NFL /NDL /NJH /NJS /NP
```

> Do **not** use `/MIR` here - `$dest` also holds all core/enterprise modules and `/MIR` would delete anything not in `$src`.

## 3) Upgrade installed modules (apply code changes)

```powershell
Stop-Service odoo-server-19.0
& $py $bin -c $cfg -d $db -u "jani_loyalty,pos_mpesa_stk" --stop-after-init
Start-Service odoo-server-19.0
```

Replace the module list with your own comma-separated names.

## 4) Install a new module (installs dependencies too)

```powershell
Stop-Service odoo-server-19.0
& $py $bin -c $cfg -d $db -i "module_name" --stop-after-init
Start-Service odoo-server-19.0
```

## 5) Service controls / useful extras

```powershell
Restart-Service odoo-server-19.0
Get-Service odoo-server-19.0
Get-Content $log -Tail 300 | Select-String "ERROR|CRITICAL|Traceback"
```

## Notes

- Always stop the service before running the CLI upgrade/install (otherwise port 8069 is already taken and two servers would touch the same DB).
- The "currently installing/upgrading" message in the UI is the normal Odoo module lock. If it looks stuck, run step 3.
- Robocopy exit codes 0-7 are success; 8+ means an error.
