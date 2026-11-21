/**
 * 华为账号取码（Account Kit）。
 *
 * 客户端只负责拿到 authorizationCode —— 换 access_token、取 OpenID、建号/绑定
 * 全部在服务端完成，Client Secret 不进安装包。
 * 系统没登录华为账号时会拉起系统登录页（forceLogin=true）。
 *
 * 登录页与资料页都要用，所以独立成工具，避免两边各写一份。
 */
import { authentication } from '@kit.AccountKit';
import { common } from '@kit.AbilityKit';

export class Huawei {
  /**
   * 拉起华为账号授权，返回 authorizationCode。
   *
   * @param context UIAbility 上下文（Account Kit 需要）
   * @returns 授权码；失败时抛 Error（业务错误码在 BusinessError.code 上）
   */
  static fetchCode(context: common.UIAbilityContext): Promise<string> {
    const request = new authentication.HuaweiIDProvider().createLoginWithHuaweiIDRequest();
    request.forceLogin = true;
    const controller = new authentication.AuthenticationController(context);

    return controller.executeRequest(request)
      .then((response: authentication.AuthenticationResponse): string => {
        const detail = response as authentication.LoginWithHuaweiIDResponse;
        // authorizationCode 在类型上是可选的：没授权成功时不会有值
        const raw: string | undefined = detail.data !== undefined && detail.data !== null
          ? detail.data.authorizationCode : undefined;
        const code: string = raw !== undefined ? raw : '';
        if (code === '') {
          throw new Error('没有拿到华为账号授权码，请重试');
        }
        return code;
      });
  }
}
