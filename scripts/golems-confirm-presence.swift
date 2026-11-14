// Touch ID only: no password, environment switch, stdin response or automatic fallback.
import Foundation
import LocalAuthentication

let context = LAContext()
context.localizedFallbackTitle = ""
context.touchIDAuthenticationAllowableReuseDuration = 0
var error: NSError?
guard CommandLine.arguments.count == 2,
      context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
    exit(2)
}
let done = DispatchSemaphore(value: 0)
var approved = false
context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics,
                       localizedReason: CommandLine.arguments[1]) { success, _ in
    approved = success
    done.signal()
}
guard done.wait(timeout: .now() + 60) == .success else {
    context.invalidate()
    exit(2)
}
exit(approved ? 0 : 2)
