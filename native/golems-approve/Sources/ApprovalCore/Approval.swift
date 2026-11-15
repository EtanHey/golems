import Foundation
import CryptoKit

public enum Refusal: Error { case invalidToken, unsafeDisplay, expired }
public protocol ApprovalSigner { func sign(_ bytes: Data, reason: String) throws -> Data }
private struct WireApproval: Decodable {
    let kind: String, nonce: String, cwd: String, command: String
    let remote_url: String, ref: String, operation: String, git_provider: String
    let issued_at: Int, expires_at: Int, version: Int
    let command_sha256: String
    let reason: String?
}
public struct Approval {
    public let kind: String, nonce: String, cwd: String, command: String
    public let remote_url: String, ref: String, operation: String, git_provider: String
    public let issued_at: Int, expires_at: Int, version: Int
    public let command_sha256: String
    public let agentReason: String?, whatHappens: String

    public init(bytes: Data, now: Int = Int(Date().timeIntervalSince1970)) throws {
        guard bytes.count <= 65536,
              let object = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes]) == bytes
        else { throw Refusal.invalidToken }
        let p = try JSONDecoder().decode(WireApproval.self, from: bytes)
        guard p.kind == "enclave", p.version == 1, p.nonce.range(of: "^[0-9a-f]{32}$", options: .regularExpression) != nil,
              p.command_sha256 == SHA256.hash(data: Data((p.cwd + "\0" + p.command).utf8)).map({ String(format: "%02x", $0) }).joined(),
              let ops = object["operations"] as? [[String: Any]], ops.count == 1,
              ops[0]["repo"] as? String == p.cwd, ops[0]["class"] as? String == p.operation
        else { throw Refusal.invalidToken }
        guard p.issued_at <= now, now < p.expires_at, p.expires_at > p.issued_at, p.expires_at - p.issued_at <= 300 else { throw Refusal.expired }
        for field in [p.cwd, p.command, p.remote_url, p.ref, p.operation, p.git_provider] {
            guard !field.isEmpty, field.utf8.count <= 400, field.unicodeScalars.allSatisfy({ (32...126).contains($0.value) }) else { throw Refusal.unsafeDisplay }
        }
        if let text = p.reason {
            guard text.unicodeScalars.count <= 200, text.unicodeScalars.allSatisfy(Self.printableReason) else { throw Refusal.unsafeDisplay }
        }
        whatHappens = try Self.operationSentence(url: p.remote_url, op: ops[0], kind: p.operation)
        kind = p.kind; nonce = p.nonce; cwd = p.cwd; command = p.command
        remote_url = p.remote_url; ref = p.ref; operation = p.operation; git_provider = p.git_provider
        issued_at = p.issued_at; expires_at = p.expires_at; version = p.version
        command_sha256 = p.command_sha256; agentReason = p.reason
    }
    private static func printableReason(_ scalar: Unicode.Scalar) -> Bool {
        if [0x115f, 0x1160, 0x3164, 0xffa0].contains(scalar.value) { return false }
        if scalar.value == 32 { return true }
        switch scalar.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
             .decimalNumber, .letterNumber, .otherNumber, .connectorPunctuation, .dashPunctuation,
             .openPunctuation, .closePunctuation, .initialPunctuation, .finalPunctuation, .otherPunctuation,
             .mathSymbol, .currencySymbol, .modifierSymbol, .otherSymbol: return true
        default: return false // Includes controls, format/bidi/zero-width and combining marks.
        }
    }
    private static func matches(_ text: String, _ pattern: String) -> Bool { text.range(of: pattern, options: .regularExpression) != nil }
    private static func operationSentence(url: String, op: [String: Any], kind: String) throws -> String {
        var repo = "repository " + url
        let regex = try NSRegularExpression(pattern: #"^(?:https://github\.com/|git@github\.com:|ssh://git@github\.com/)([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+?)(?:\.git)?$"#)
        if let match = regex.firstMatch(in: url, range: NSRange(url.startIndex..., in: url)), let range = Range(match.range(at: 1), in: url) {
            repo = "GitHub repo " + url[range]
        }
        if kind == "settings" {
            guard let target = op["target"] as? String,
                  matches(target, #"^repos/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/(?:rulesets/[0-9]+|branches/[A-Za-z0-9_./-]+/protection)$"#) else { throw Refusal.invalidToken }
            return "Change repository protections at \(target). This may permit destructive changes."
        }
        let target: String
        if kind == "lease", let ref = op["ref"] as? String { target = ref }
        else if ["delete", "force", "rewrite"].contains(kind), var refs = op["refs"] as? [String] {
            if kind == "rewrite" { refs.removeAll { ["--force", "-f", "--"].contains($0) } }
            guard refs.count == 1 else { throw Refusal.invalidToken }
            target = String(refs[0].drop(while: { $0 == "+" }).split(separator: ":", omittingEmptySubsequences: false).last!)
        } else { throw Refusal.invalidToken }
        guard matches(target, #"^refs/heads/[A-Za-z0-9][A-Za-z0-9_./-]*$"#), !target.contains(".."), !target.contains("//") else { throw Refusal.invalidToken }
        let branch = target.dropFirst("refs/heads/".count)
        switch kind {
        case "delete": return "Delete branch \(branch) from \(repo). This cannot be undone."
        case "force": return "Force-push over branch \(branch) in \(repo). Remote history may be overwritten."
        case "lease": return "Force-push over branch \(branch) in \(repo) only if its expected remote revision still matches."
        case "rewrite": return "Rewrite shared history on branch \(branch) in \(repo)."
        default: throw Refusal.invalidToken
        }
    }
    public var reason: String {
        let formatter = DateFormatter(); formatter.dateFormat = "yyyy-MM-dd HH:mm:ss Z"
        let directory = cwd.count > 96 ? String(cwd.prefix(96)) + "..." : cwd
        let why = agentReason.map { "\nWhy (the agent's words, not checked): " + $0 } ?? ""
        return "What happens: \(whatHappens)\(why)\nOperation: \(operation)\nCommand: \(command)\nDirectory: \(directory)\nExpires: \(formatter.string(from: Date(timeIntervalSince1970: Double(expires_at))))"
    }
    public static func approve(_ bytes: Data, signer: ApprovalSigner) throws -> Data {
        let token = try Approval(bytes: bytes)
        guard token.reason.utf8.count <= 1000 else { throw Refusal.unsafeDisplay }
        let signature = try signer.sign(bytes, reason: token.reason)
        guard Int(Date().timeIntervalSince1970) < token.expires_at else { throw Refusal.expired }
        return signature
    }
}
