// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "openagent-island",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "OpenAgentIsland",
            path: "Sources/OpenAgentIsland"
        )
    ]
)
