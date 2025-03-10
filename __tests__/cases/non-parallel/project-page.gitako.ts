import {
  expandFloatModeSidebar,
  expectToFind,
  expectToNotFind,
  scroll,
  selectFileTreeItem
} from '../../utils'

describe(`in Gitako project page`, () => {
  beforeAll(() => page.goto('https://github.com/EnixCoda/Gitako'))

  it('should render Gitako', async () => {
    await expectToFind('.gitako-side-bar .gitako-side-bar-body-wrapper')
  })

  it('should render file list', async () => {
    await expectToFind('.gitako-side-bar .files .node-item')
  })

  it('should render while scroll', async () => {
    await expandFloatModeSidebar()

    const filesEle = await page.waitForSelector('.gitako-side-bar .files')
    // node of tsconfig.json should NOT be rendered before scroll down
    await expectToNotFind(selectFileTreeItem('package.json'))
    const box = await filesEle?.boundingBox()
    if (box) {
      await page.mouse.move(box.x + 40, box.y + 40)
      await scroll({ totalDistance: 200, duration: 1000 })

      // node of tsconfig.json should be rendered now
      await expectToFind(selectFileTreeItem('tsconfig.json'))
    }
  })
})
