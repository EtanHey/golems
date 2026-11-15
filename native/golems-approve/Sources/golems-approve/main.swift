import Foundation
import Security
import LocalAuthentication
import ApprovalCore

// No env or flag selects a provider. No software-key implementation in this target.
struct EnclaveSigner: ApprovalSigner {
    let group: String
    let tag = Data("com.golems.approve.p256.v1".utf8)
    func query(_ context: LAContext) -> [String: Any] {
        [kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: tag,
         kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
         kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
         kSecAttrAccessGroup as String: group, kSecUseDataProtectionKeychain as String: true,
         kSecUseAuthenticationContext as String: context, kSecReturnRef as String: true]
    }
    func context(_ reason: String) throws -> LAContext {
        let context = LAContext()
        context.localizedReason = reason
        context.localizedFallbackTitle = ""
        context.touchIDAuthenticationAllowableReuseDuration = 0
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            throw error ?? Refusal.invalidToken as NSError
        }
        return context
    }
    func key(_ context: LAContext) throws -> SecKey {
        var value: CFTypeRef?
        let status = SecItemCopyMatching(query(context) as CFDictionary, &value)
        guard status == errSecSuccess, let value else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
        return value as! SecKey
    }
    func sign(_ bytes: Data, reason: String) throws -> Data {
        let context = try context(reason); defer { context.invalidate() }
        var error: Unmanaged<CFError>?
        guard let signature = SecKeyCreateSignature(try key(context), .ecdsaSignatureMessageX962SHA256, bytes as CFData, &error) else {
            throw error!.takeRetainedValue()
        }
        return signature as Data
    }
    func enroll() throws -> Data {
        let context = try context("Create the Golems approval key. Future use requires Touch ID for the displayed command.")
        defer { context.invalidate() }
        var existing: CFTypeRef?
        let status = SecItemCopyMatching(query(context) as CFDictionary, &existing)
        guard status == errSecItemNotFound else { throw Refusal.invalidToken } // Never replace.
        var error: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
                                                          [.privateKeyUsage, .biometryCurrentSet], &error) else { throw error!.takeRetainedValue() }
        let attributes: [String: Any] = [kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256, kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
            kSecUseDataProtectionKeychain as String: true, kSecUseAuthenticationContext as String: context,
            kSecPrivateKeyAttrs as String: [kSecAttrIsPermanent as String: true, kSecAttrApplicationTag as String: tag,
                kSecAttrAccessGroup as String: group, kSecAttrAccessControl as String: access]]
        guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error),
              let pub = SecKeyCopyPublicKey(key), let point = SecKeyCopyExternalRepresentation(pub, &error) else { throw error!.takeRetainedValue() }
        // Exercise privateKeyUsage once: creation itself need not request biometry.
        guard SecKeyCreateSignature(key, .ecdsaSignatureMessageX962SHA256, Data("golems-enrolment-v1".utf8) as CFData, &error) != nil else { throw error!.takeRetainedValue() }
        let prefix: [UInt8] = [0x30,0x59,0x30,0x13,0x06,0x07,0x2a,0x86,0x48,0xce,0x3d,0x02,0x01,0x06,0x08,0x2a,0x86,0x48,0xce,0x3d,0x03,0x01,0x07,0x03,0x42,0x00]
        return Data(prefix) + (point as Data)
    }
}

func signingGroup() throws -> String {
    var code: SecCode?
    guard SecCodeCopySelf([], &code) == errSecSuccess, let code,
          SecCodeCheckValidity(code, SecCSFlags(rawValue: kSecCSStrictValidate), nil) == errSecSuccess else { throw Refusal.invalidToken }
    var staticCode: SecStaticCode?
    guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode else { throw Refusal.invalidToken }
    var info: CFDictionary?
    guard SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess,
          let data = info as? [String: Any], let team = data[kSecCodeInfoTeamIdentifier as String] as? String, team == "PPN23G925Y",
          data[kSecCodeInfoIdentifier as String] as? String == "com.golems.approve",
          let entitlements = data[kSecCodeInfoEntitlementsDict as String] as? [String: Any],
          entitlements["com.apple.application-identifier"] as? String == team + ".com.golems.approve",
          entitlements["keychain-access-groups"] as? [String] == [team + ".com.golems.approve"],
          entitlements["com.apple.security.get-task-allow"] as? Bool != true,
          entitlements["com.apple.security.cs.disable-library-validation"] as? Bool != true,
          let flags = data[kSecCodeInfoFlags as String] as? UInt32, flags & 0x10000 != 0
    else { throw Refusal.invalidToken }
    // The OS validates the provisioned group. Another Team's rebuilt binary sees a different group/key.
    return team + ".com.golems.approve"
}

DispatchQueue.global().asyncAfter(deadline: .now() + 120) { exit(2) }
do {
    let signer = EnclaveSigner(group: try signingGroup())
    if CommandLine.arguments == [CommandLine.arguments[0], "--enroll"] {
        FileHandle.standardOutput.write(try signer.enroll())
    } else {
        guard CommandLine.arguments.count == 1 else { throw Refusal.invalidToken }
        let bytes = FileHandle.standardInput.readData(ofLength: 65537)
        FileHandle.standardOutput.write(try Approval.approve(bytes, signer: signer))
    }
} catch {
    FileHandle.standardError.write(Data("golems-approve refused: \(error)\n".utf8)); exit(2)
}
