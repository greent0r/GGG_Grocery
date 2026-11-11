# GGG杂货铺

蓝色相片货架，部署到 GitHub Pages，无登录、后台或付费服务。

## 添加照片

在 GitHub 中进入 `photos` 文件夹，选择 **Add file → Upload files**，上传照片并提交到 `main`。网站随后自动更新。

支持 JPG、PNG、WebP、GIF 和 AVIF。每张照片自动生成缩略图和浏览大图；点击「查看原图」打开未经修改的原文件。删除仓库中的对应文件即可在下次发布时移除照片。

代码中不额外限制图片大小，但上传、仓库和网站容量仍受 GitHub 平台限制。照片文件和原图都会公开。

## 本地预览

```sh
python -m pip install -r requirements.txt
python scripts/build.py
python -m http.server 8790 --directory _site
```

打开 `http://localhost:8790`。

首次部署需要在仓库 **Settings → Pages → Source** 选择 **GitHub Actions**。之后每次提交都会触发自动发布。
