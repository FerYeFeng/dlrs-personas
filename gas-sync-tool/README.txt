GAS 用户 UID 缓存同步工具

1. 把整个 gas-sync-tool 文件夹复制到没被 WAF 拦截的电脑。
2. 双击 sync-gas-users-80000.bat 开始从 UID 1140 扫到 75000，当前使用 token 查询，appid 为 48，20 线程，不额外等待间隔。
3. 想看当前扫到哪，双击 查看GAS同步进度.bat。
4. 同步结果会保存到：
   - data\gas-users.json：只包含 GAS 用户缓存，推荐拿回来导入。
   - data\db.json：同步工具自己的数据库副本。
   - data\gas-sync-state.json：当前进度。
   - data\gas-sync-failed.txt：失败过的 UID。
5. 回到网站电脑后，把 gas-sync-tool 文件夹复制回 D:\dlrs-personas\gas-sync-tool，
   然后双击 导入到网站数据库.bat，把 GAS 缓存合并进网站数据库。

注意：
- 不要直接用 gas-sync-tool\data\db.json 覆盖网站的 D:\dlrs-personas\data\db.json。
- 中途关掉没事，下次双击 sync-gas-users-80000.bat 会从进度文件继续。
- 如果别的电脑也被拦，进度会继续走，但 data\gas-sync-failed.txt 会大量增加。
- token 放在 data\gas-sync-token.txt；如果删除 token，脚本默认会退回每个 UID 间隔 2 秒。
