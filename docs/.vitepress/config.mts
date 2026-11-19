import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'LiveAutoRecord',
  description: '支持多个直播平台的自动录制工具：系统架构、HTTP API、CLI 与平台插件开发文档',
  lang: 'zh-CN',
  base: '/LiveAutoRecord/',
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '系统架构', link: '/architecture' },
      { text: 'HTTP API', link: '/api' },
      { text: 'CLI', link: '/cli' },
      { text: '插件开发', link: '/providers' },
      { text: 'GitHub', link: 'https://github.com/jinhuan138/LiveAutoRecord' },
    ],
    sidebar: [
      {
        text: '文档',
        items: [
          { text: '系统架构', link: '/architecture' },
          { text: 'HTTP API 参考', link: '/api' },
          { text: 'CLI 使用指南', link: '/cli' },
          { text: '平台录制器插件开发指南', link: '/providers' },
          { text: '构建与运行时警告说明', link: '/build-warnings' },
        ],
      },
      {
        text: '历史计划',
        items: [
          { text: 'Yarn 3 → pnpm 迁移计划', link: '/pnpm-migration-plan' },
          { text: 'vm2 替换计划', link: '/vm2-replacement-plan' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/jinhuan138/LiveAutoRecord' }],
    outline: { level: [2, 3], label: '本页目录' },
    docFooter: { prev: '上一篇', next: '下一篇' },
    lastUpdatedText: '最后更新',
    darkModeSwitchLabel: '外观',
    sidebarMenuLabel: '菜单',
    returnToTopLabel: '返回顶部',
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
          modal: {
            noResultsText: '无法找到相关结果',
            resetButtonTitle: '清除查询条件',
            footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
          },
        },
      },
    },
    editLink: {
      pattern: 'https://github.com/jinhuan138/LiveAutoRecord/edit/master/docs/:path',
      text: '在 GitHub 上编辑此页',
    },
  },
})
