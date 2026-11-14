import Foundation
import CryptoKit

public enum Refusal: Error { case invalidToken, unsafeDisplay, expired }
public protocol ApprovalSigner { func sign(_ bytes: Data, reason: String) throws -> Data }
public struct Approval: Decodable {
    public let kind: String, nonce: String, cwd: String, command: String
    public let remote_url: String, ref: String, operation: String, git_provider: String
    public let issued_at: Int, expires_at: Int, version: Int
    public let command_sha256: String

    public init(bytes: Data, now: Int = Int(Date().timeIntervalSince1970)) throws {
        guard bytes.count <= 65536,
              let object = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes]) == bytes
        else { throw Refusal.invalidToken }
        self = try JSONDecoder().decode(Self.self, from: bytes)
        guard kind == "enclave", version == 1, nonce.range(of: "^[0-9a-f]{32}$", options: .regularExpression) != nil,
              ["force", "lease", "delete", "rewrite", "settings"].contains(operation),
              command_sha256 == SHA256.hash(data: Data((cwd + "\0" + command).utf8)).map({ String(format: "%02x", $0) }).joined(),
              let ops = object["operations"] as? [[String: Any]], ops.count == 1,
              ops[0]["repo"] as? String == cwd
        else { throw Refusal.invalidToken }
        guard issued_at <= now, now < expires_at, expires_at > issued_at, expires_at - issued_at <= 300 else { throw Refusal.expired }
        // Deliberately ASCII-only: also rejects bidi, zero-width and homoglyph tricks.
        for field in [cwd, command, remote_url, ref, operation, git_provider] {
            guard !field.isEmpty, field.utf8.count <= 400, field.unicodeScalars.allSatisfy({ (32...126).contains($0.value) }) else { throw Refusal.unsafeDisplay }
        }
    }
    public var reason: String {
        let formatter = DateFormatter(); formatter.dateFormat = "yyyy-MM-dd HH:mm:ss Z"
        return "Approve \(operation)\nRemote: \(remote_url)\nRef: \(ref)\nDirectory: \(cwd)\nGit: \(git_provider)\nCommand: \(command)\nExpires: \(formatter.string(from: Date(timeIntervalSince1970: Double(expires_at))))"
    }
    public static func approve(_ bytes: Data, signer: ApprovalSigner) throws -> Data {
        let token = try Approval(bytes: bytes)
        guard token.reason.utf8.count <= 1000 else { throw Refusal.unsafeDisplay }
        let signature = try signer.sign(bytes, reason: token.reason)
        guard Int(Date().timeIntervalSince1970) < token.expires_at else { throw Refusal.expired }
        return signature
    }
}
