@echo off
cd /d "D:\dlrs-personas"
echo DLRS 人物志网站启动中...
echo 地址: http://localhost:9000/
start "" "http://localhost:9000/"
node server.js
