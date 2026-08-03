export default defineAppConfig({
  pages: [
    'pages/login/index',
    'pages/home/index',
    'pages/space/index',
    'pages/shared/index',
    'pages/profile/index',
    'pages/scan-login/index',
    'pages/document/index',
    'pages/mindmap/index',
    'pages/spreadsheet/index',
    'pages/gantt/index'
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#ffffff',
    navigationBarTitleText: 'KW',
    navigationBarTextStyle: 'black',
    backgroundColor: '#f7f9fd'
  },
  tabBar: {
    color: '#93a0b4',
    selectedColor: '#5f82d1',
    backgroundColor: '#ffffff',
    borderStyle: 'white',
    list: [
      { pagePath: 'pages/home/index', text: '首页' },
      { pagePath: 'pages/space/index', text: '空间' },
      { pagePath: 'pages/shared/index', text: '共享' },
      { pagePath: 'pages/profile/index', text: '我的' }
    ]
  }
})
