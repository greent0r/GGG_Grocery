# GGG杂货铺

页面是一间杂货店，直接展示龟龟和小丘的相片货柜。部署到 GitHub Pages，无登录、后台或付费服务。

店内墙上有一个电子相册入口，弹窗只包含两项能力：Web Bluetooth 连接 FRAMEFILM 设备，以及在浏览器本地把照片转换为 `.film` 后发送到设备。设备协议和 Film 转换沿用 `ForFilm` 的实现；照片不会上传到网站服务器。

## 添加照片

原图先按老板、再按拍摄日期分文件夹：龟龟放在 `photos/guigui/YYYY-MM-DD/`，小丘放在 `photos/xiaoqiu/YYYY-MM-DD/`。在对应日期文件夹中选择 **Add file → Upload files**，上传原图并提交到 `main`，网站随后自动更新。较大的文件可以通过 Git 上传。

支持 JPG、PNG、WebP、GIF 和 AVIF。每张照片自动生成缩略图和浏览大图；点击「查看原图」打开未经修改的原文件。删除仓库中的对应文件即可在下次发布时移除照片。

日期分组保持先后顺序，同一天的照片在构建时按整体配色、明暗与对比度自动编排，网页直接使用生成顺序。原图不会因排序或生成预览而修改。部分导出图片的 EXIF 损坏时，读取有效的 XMP 信息；没有有效拍摄日期时使用照片所在的日期文件夹，不补造拍摄时间。

代码中不额外限制图片大小，但上传、仓库和网站容量仍受 GitHub 平台限制。照片文件和原图都会公开。

## 本地预览

```sh
python -m pip install -r requirements.txt
python scripts/build.py
python -m http.server 8790 --directory _site
```

打开 `http://localhost:8790`。

首次部署需要在仓库 **Settings → Pages → Source** 选择 **GitHub Actions**。之后每次提交都会触发自动发布。
