Jest 提供了多种方式让你单独运行特定的测试文件或测试用例。以下是具体方法：
1. 运行单个测试文件
使用 jest 命令并指定文件路径：
bash
npx jest test/leave.test.js --detectOpenHandles
test/leave.test.js：指定要运行的测试文件。
--detectOpenHandles：保留此选项以检测未关闭的句柄。
或者，如果你使用的是 npm test 定义的脚本：
bash
npm test -- test/leave.test.js --detectOpenHandles
-- 将参数传递给 jest。
示例：运行 addMember.test.js：
bash
npx jest test/addMember.test.js --detectOpenHandles
2. 运行文件中特定的测试用例
如果只想运行某个测试文件中的特定测试用例，可以使用 -t 或 --testNamePattern 参数。例如：
假设 addMember.test.js 中有测试用例 Should successfully add a member：
bash
npx jest test/addMember.test.js -t "Should successfully add a member" --detectOpenHandles
-t "Should successfully add a member"：匹配测试用例的描述。
3. 使用 Jest 的交互模式
Jest 提供交互式模式，让你选择要运行的测试：
bash
npx jest --watch
运行后，按 a 运行所有测试，或按 f 运行失败的测试，或按 p 输入文件名模式（如 leave）选择特定文件。
适合开发过程中快速调试。
4. 在代码中临时跳过其他测试
在测试文件中，使用 test.only 或 describe.only 只运行特定测试。例如：
javascript
// test/addMember.test.js
test.only('Should successfully add a member', async () => {
  // 测试代码
});
然后运行：
bash
npx jest test/addMember.test.js --detectOpenHandles
完成后记得移除 .only。
5. 配置文件支持（可选）
如果经常需要运行特定测试，可以在 package.json 或 jest.config.js 中添加自定义脚本。例如：
json
// package.json
"scripts": {
  "test": "NODE_ENV=test jest --detectOpenHandles",
  "test:leave": "NODE_ENV=test jest test/leave.test.js --detectOpenHandles",
  "test:addMember": "NODE_ENV=test jest test/addMember.test.js --detectOpenHandles"
}
运行：
bash
npm run test:leave
npm run test:addMember
示例：单独运行 addMember.test.js
假设你想验证 addMember.test.js 是否正常工作：
命令行执行：
bash
npx jest test/addMember.test.js --detectOpenHandles
预期输出：
如果一切正常，你会看到类似 PASS test/addMember.test.js 和 6 个测试用例通过的日志。
如果有错误，日志会显示具体失败的测试用例和堆栈信息。
总结
当前状态：所有测试通过，环境稳定，无需进一步修复。
单独测试方法：
运行整个文件：npx jest test/<filename>.js --detectOpenHandles
运行特定用例：npx jest test/<filename>.js -t "<test name>" --detectOpenHandles
使用交互模式：npx jest --watch
添加 test.only 或自定义脚本。


全部测试：npm test -- --detectOpenHandles   
npm test -- test/license-request.test.js --detectOpenHandles                // 申请许可
npm test -- test/leave.test.js --detectOpenHandles                        // 退出成员
npm test -- test/addMember.test.js --detectOpenHandles                    // 添加成员
npm test -- test/remove-member.test.js --detectOpenHandles                // 移除成员
npm test -- test/approve-license-request.test.js --detectOpenHandles     // 超级管理员订阅审批
npm test -- test/super-admin-get-license-requests.test.js --detectOpenHandles    // 超级管理员获取许可申请列表
npm test -- test/get-members.test.js --detectOpenHandles                 // 订阅者获取成员列表
npm test -- test/warehouse.test.js --detectOpenHandles                  // 仓库测试
npm test -- test/permission.test.js --detectOpenHandles                                        // 权限测试
npm test -- test/auth.test.js --detectOpenHandles


/Users/ellisfrancis/Documents/opsaway/opsaway-b/test/addMember.test.js


确保 app.js 只导出 { app }，而不是 { app, server }。
移除 server 从 module.exports，只导出 { app }。

调整测试文件：
在 leave.test.js 和 addMember.test.js 中使用 let server 并通过 app.listen(0) 启动。


问题分析
1. Should succeed for "renew" type even with active license
失败原因：Duplicate entry 'fd25936d-80e5-420e-a41d-6ab4fd134838' for key 'user_licenses.uk_user_id'
LicenseModel.createLicense 尝试为同一用户创建第二个许可，但 user_licenses 表有唯一约束 uk_user_id，不允许重复 user_id。

测试脚本在 beforeEach 未清理 user_licenses，导致重复插入。

修复思路：
在 beforeEach 中清理 user_licenses 记录。

调整测试逻辑，避免重复创建许可。

2. Should fail when user has a pending request, Should get user pending request, Should cancel pending request successfully
失败原因：用户已拥有有效许可
LicenseRequestModel.createRequest 在这些测试用例中调用时，因用户已有活跃许可（status = 'active'），触发了 if (type === 'new') 的检查并抛出错误。

测试脚本未正确清理许可，导致后续测试逻辑错误。

修复思路：
确保测试用例在创建待处理申请前无活跃许可。

更新 beforeEach 清理逻辑，移除所有许可和申请。

3. 逻辑不匹配
当前 createRequest 在模型层直接检查许可状态并抛出错误，而控制器期望捕获此错误并返回 400。但测试预期是基于控制器返回的响应，而非模型抛出的异常。

修复思路：
调整测试用例，捕获正确的错误响应。

# 移除成员测试记录
邮箱不匹配：
beforeEach 中使用 ${memberId}@example.com 添加成员，但 memberId 是 UUID（如 349092b6-a574-4060-96bb-2b86e8fcd7fd），不是实际用户的邮箱（testmember_1743437260347@example.com）。MemberModel.addMember 检查邮箱是否已注册（UserModel.findByEmail），未找到匹配用户，导致 member_id 为 null，后续移除时找不到记录。

成员数量超限：
日志显示 current_members 在测试过程中不断增加（从 0 到 5），beforeEach 未正确清理，导致后续添加失败。

修复许可状态：
在 beforeEach 中添加 status = "active" 到 UPDATE user_licenses 语句，确保每次测试前许可状态为 active，避免因前一测试（如 Should fail when license is expired）修改状态而影响后续测试。

保持环境一致性：
重置 current_members = 0 和 status = "active"，确保 MemberModel.addMember 能成功执行。

根本问题
许可状态被意外修改：
在 Should fail when license is expired 测试中，UPDATE user_licenses SET status = "expired" 修改了数据库中的许可状态，且后续 beforeEach 未正确恢复，导致后续测试中 MemberModel.addMember 失败。

beforeEach 假设每次测试前许可状态为 active，但未显式重置 status。

需要确保 beforeEach 在每次测试前正确重置许可状态为 active，以避免前一个测试的副作用影响后续测试

根本问题
认证中间件优先捕获错误：
authMiddleware 调用 LicenseModel.checkLicenseStatus，而后者依赖 db.execute。当 db.execute 被 mock 为抛出错误时，authMiddleware 的 catch 块捕获异常并返回 401（"认证失败"），阻止请求到达 MemberController.removeMember，因此无法触发 500 响应。

测试设计问题：
当前 mock 影响了所有 db.execute 调用，包括中间件的数据库查询，而非仅针对控制器的数据库操作。

未关闭的句柄
TCPWRAP (Redis)：
Redis 客户端未正确关闭，可能是 redisService.quit() 未完全生效。

TCPSERVERWRAP (Express)：
Express 服务器未正确关闭，可能由于异步操作未完成。

修复建议
修复失败的测试
需要调整 Should fail with server error if database fails 测试，确保 mock 仅影响控制器逻辑，而不干扰中间件。可以通过在测试中延迟应用 mock，或者在中间件执行后再 mock 数据库错误。以下是修复后的脚本：
解决未关闭句柄
对 Redis 客户端和 Express 服务器添加更健壮的关闭逻辑，确保测试完成后资源释放。

修改点说明
修复服务器错误测试：
使用更精确的 jest.spyOn mock，仅针对 user_members 和 user_licenses 相关的数据库操作抛出错误，避免影响 authMiddleware 和 LicenseMiddleware 的查询。

确保请求通过中间件后，在 MemberModel.removeMember 中触发数据库错误，返回 500。

解决未关闭句柄：
在 afterAll 中使用 redisService.client.quit() 替代 redisService.quit()，确保 Redis 客户端显式关闭。

添加 500ms 延迟，确保服务器关闭完成。

根本问题
Mock 范围过广：
当前的 dbSpy.mockImplementation 虽然尝试限制只对 user_members 和 user_licenses 查询抛出错误，但仍然影响了 authMiddleware 的数据库查询（例如 SELECT user_id FROM user_members），导致请求未到达控制器。

句柄未关闭：
Redis 和 Express 的关闭逻辑可能因异步操作未完成或 Jest 的检测时机问题而未生效。

修复方案
修复失败的测试
需要调整 mock 逻辑，确保只在控制器执行的数据库操作中抛出错误，而不影响中间件。具体方法是：
在中间件完成认证后，再应用 mock。

使用更精确的 mock，仅针对 MemberModel.removeMember 的数据库查询。

解决未关闭句柄
确保 Redis 客户端和 Express 服务器在测试结束后强制关闭，避免 Jest 检测到未释放的资源。

失败原因
超时错误：

thrown: "Exceeded timeout of 5000 ms for a hook.
Add a timeout value to this test to increase the timeout, if this is a long-running test."
at afterAll (test/remove-member.test.js:47:3)

afterAll 中的清理逻辑（数据库删除、Redis 关闭、服务器关闭）耗时超过 Jest 默认的 5000ms 超时限制。

可能原因：
db.execute 操作因 mock（jest.spyOn(db, 'execute').mockRejectedValue）未完全清理，导致后续真实查询阻塞。

redisService.client.quit() 或 server.close() 未及时完成。

未关闭句柄
TCPWRAP (Redis)：
Redis 客户端未正确关闭。

TCPSERVERWRAP (Express)：
Express 服务器未正确关闭。

问题根源：
afterAll 中的清理逻辑虽添加了 process.exit(0)，但超时导致未执行到此步骤。

修复方案
修复超时问题
方法 1：增加超时时间：
为 afterAll 设置更长的超时，避免中断。

方法 2：优化清理逻辑：
确保 mock 在每次测试后清理，避免影响 afterAll 的数据库操作。

使用异步等待确保所有资源释放完成。

推荐：结合两者，既增加超时，又优化逻辑。

修复未关闭句柄
方法：
在 afterAll 中显式关闭 Redis 和 Express，确保资源释放。

使用 jest.useFakeTimers 和延迟确保异步操作完成。











