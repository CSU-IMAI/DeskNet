# GitHub Release 发布说明

这个目录是 DeskNest 1.0.0 的完整 GitHub Release 素材。

## 内容

- `DeskNest_1.0.0_x64-setup.exe`：Windows x64 安装包
- `DeskNest-win-x64-portable.zip`：Windows x64 便携版
- `RELEASE_NOTES.md`：粘贴到 GitHub Release 描述框的正文
- `SHA256SUMS.txt`：两个产物的校验值
- `release.json`：Release 元数据（tag、标题、附件）
- `publish-github-release.ps1`：使用 GitHub CLI 创建 Draft Release

## 方式一：网页发布

1. 打开仓库的 **Releases → Draft a new release**。
2. Tag 填 `v1.0.0`。
3. Title 填 `DeskNest 1.0.0 — Windows 桌面管理器`。
4. Description 粘贴 `RELEASE_NOTES.md` 全文。
5. 上传 `DeskNest_1.0.0_x64-setup.exe`、`DeskNest-win-x64-portable.zip`、`SHA256SUMS.txt`。
6. 不勾选 pre-release，点击 **Publish release**。

## 方式二：GitHub CLI

先安装并登录：

```powershell
winget install --id GitHub.cli
gh auth login
```

在本目录执行：

```powershell
.\publish-github-release.ps1 -Repo 用户名/仓库名
```

脚本会创建 **Draft** Release，检查无误后在 GitHub 页面点击 Publish。

## 校验

```powershell
Get-FileHash .\DeskNest_1.0.0_x64-setup.exe -Algorithm SHA256
Get-FileHash .\DeskNest-win-x64-portable.zip -Algorithm SHA256
```

期望值见 `SHA256SUMS.txt`。
