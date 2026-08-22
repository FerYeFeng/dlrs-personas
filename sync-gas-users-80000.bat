@echo off
cd /d "D:\dlrs-personas"
echo GAS 用户同步开始，范围 1 到 80000。
echo 进度会保存到 data\gas-sync-state.json，失败 UID 会写入 data\gas-sync-failed.txt。
python "%~dp0sync-gas-users.py" --start 1 --end 80000 --resume --retries 3 --save-every 100 --status-every 1 --delay-ms 120
echo.
echo 同步结束，按任意键关闭。
pause >nul
