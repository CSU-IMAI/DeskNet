# DeskNest 1.0.0 — 开机自启动与文件夹内容索引

本次更新新增开机自启动，以及文件夹内部文件索引和文件级搜索。

## 开机自启动

- 设置 →「启动」新增「开机自启动」开关，默认关闭。
- 开启后写入当前用户的 Windows 启动项，登录后自动运行 DeskNest。
- 开机启动使用 `--autostart` 参数，静默启动到系统托盘，不弹出主窗口。
- 移动安装目录或便携版位置后，下次启动会自动更新启动项路径。
- 关闭开关会删除启动项。
- Linux 使用 `~/.config/autostart` 下的 `.desktop` 启动项。

## 文件夹内容索引

- 文件区仍然以文件夹为单位显示，内部文件不会拆成多张卡片。
- 文件夹项目会索引内部文件：文件名、相对路径、扩展名、大小、修改时间。
- 搜索对象改为**具体文件**：输入文件夹内部文件名，返回该文件本身，而不是笼统的文件夹。
- 搜索结果显示文件名、所属文件夹和大小，点击可直接打开；详情中显示所属位置。
- 文件夹详情仍列出内部文件，便于查看文件夹结构。
- 新增资料库目录监听：文件夹内新增、删除或修改文件后，约 1 秒内自动重建索引并同步到搜索。
- 兼容旧版本：已有文件夹无需重新导入，启动或扫描后自动补建内容索引。
- 主界面顶部新增「扫描内容」按钮，可手动重新扫描全部保存内容并重建索引。

## 下载

| 文件 | 大小 | SHA-256 |
| --- | ---: | --- |
| `DeskNest_1.0.0_x64-setup.exe` | 1,774,037 字节 | `93AB07378B71B6B1F9D7A60CDF023FB0C4E4AB3D6897427B35A5AFDB0A0A886C` |
| `DeskNest-win-x64-portable.zip` | 2,173,103 字节 | `2B33A21A3B7DFACB84EEFCEBFF90B66CDBCD0915A16BA5AAD9A2004D69A73215` |

- 安装版：运行安装程序。
- 便携版：解压后运行 `DeskNest.exe`，保留 `WebView2Loader.dll`。
- 系统要求：Windows 10 / 11 x64，已安装 Microsoft Edge WebView2 Runtime。

## 校验

```powershell
Get-FileHash .\DeskNest_1.0.0_x64-setup.exe -Algorithm SHA256
Get-FileHash .\DeskNest-win-x64-portable.zip -Algorithm SHA256
```

期望值：

```text
93AB07378B71B6B1F9D7A60CDF023FB0C4E4AB3D6897427B35A5AFDB0A0A886C  DeskNest_1.0.0_x64-setup.exe
2B33A21A3B7DFACB84EEFCEBFF90B66CDBCD0915A16BA5AAD9A2004D69A73215  DeskNest-win-x64-portable.zip
```
