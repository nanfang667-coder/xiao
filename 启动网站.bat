@echo off
chcp 65001 >nul
title Hulim 网站服务
cd /d %~dp0

rem 自动获取当前联网网卡的局域网 IP（优先取有默认网关的活动网卡）
set LANIP=
for /f "delims=" %%i in ('powershell -NoProfile -Command "$ip=(Get-NetIPConfiguration ^| Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up' } ^| Select-Object -First 1 -ExpandProperty IPv4Address).IPAddress; if(-not $ip){$ip=(Get-NetIPAddress -AddressFamily IPv4 ^| Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } ^| Select-Object -First 1 -ExpandProperty IPAddress)}; $ip"') do set LANIP=%%i
if "%LANIP%"=="" set LANIP=（未检测到，请确认已连接WiFi/热点）

echo ========================================
echo   正在启动网站，请稍候...
echo.
echo   本机访问: http://localhost:3000
echo   后台管理: http://localhost:3000/admin
echo.
echo   手机访问（需与电脑连同一WiFi/热点）:
echo   http://%LANIP%:3000
echo.
echo   关闭本窗口即停止网站
echo ========================================

rem 5秒后自动打开浏览器（等服务器先启动）
start "" cmd /c "timeout /t 5 /nobreak >nul && start http://localhost:3000"

npm run dev
