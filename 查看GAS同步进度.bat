@echo off
cd /d "D:\dlrs-personas"
echo 正在查看 GAS 同步进度。按 Ctrl+C 退出。
python "%~dp0view-gas-sync-progress.py"
