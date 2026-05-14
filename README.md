# Calvin Auto Compliance Briefing

一个部署到 GitHub Pages 的纯静态网站，用于生成汽车数据合规月度快讯。

网站不接入 Gemini API，也不需要后端。用户在页面中复制提示词，到 Gemini 检索后把 JSON 粘贴回来，人工审核后导出基于 Word 母版的 `.docx` 文件。

## 当前能力

- 浅色营销首页与向导式工作台
- 公众号 / 网页参考来源分组管理
- 第一轮 Gemini 提示词复制
- 境内 / 域外补足提示词复制，支持补到 10 条或单条补充
- JSON 解析、去重、按日期排序
- 卡片式审核、编辑、删除、新增条目
- 原文链接一键打开核验
- 浏览器本地自动缓存草稿
- 基于内置 Word 母版导出 `.docx`

## 使用流程

1. 打开网站，点击“开始生成”或“继续草稿”。
2. 确认或编辑来源清单。
3. 复制第一轮提示词，发送给 Gemini。
4. 粘贴 Gemini 返回的 JSON，解析第一轮结果。
5. 在补足步骤中选择境内 / 域外，复制对应补足提示词，直到境内和域外各 10 条。
6. 在审核步骤打开原文链接核验，必要时手动替换链接或摘要。
7. 点击“导出 Word”生成快讯文档。

## 本地开发

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

构建产物输出到 `dist`。

## GitHub Pages 部署

仓库包含 GitHub Actions 工作流：`.github/workflows/deploy.yml`。

推送到 `main` 分支后，GitHub Actions 会自动：

1. 安装依赖
2. 执行 `npm run build`
3. 上传 `dist`
4. 部署到 GitHub Pages

首次发布后，请到 GitHub 仓库：

`Settings` → `Pages` → `Build and deployment` → `Source`

确认选择的是 `GitHub Actions`。

## JSON 格式

```json
{
  "issue_month": "YYYY-MM",
  "date_range": {
    "start": "YYYY-MM-01",
    "end": "YYYY-MM-DD"
  },
  "items": [
    {
      "region": "domestic",
      "date": "YYYY-MM-DD",
      "title": "短标题",
      "summary": "4月16日，摘要正文……",
      "source_name": "来源名称",
      "url": "https://example.com/article"
    }
  ]
}
```

## 注意事项

- GitHub Pages 是静态站点托管，公开仓库的 Pages 站点可被访问。
- 网站数据保存在使用者自己的浏览器本地，不共享账号或团队数据库。
- `public/templates/newsletter-template.docx` 是导出的内置 Word 母版。
- `public/assets` 中的图片用于首页与工作台视觉背景。
