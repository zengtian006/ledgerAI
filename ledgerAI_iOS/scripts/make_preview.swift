// Usage: swift make_preview.swift <input.mov> <output.mp4> <startSeconds> <durationSeconds>
// Trims a Simulator recording and scales it to the 886 x 1920 portrait size App Store Connect accepts for app previews.
import AVFoundation

let args = CommandLine.arguments
guard args.count == 5, let start = Double(args[3]), let length = Double(args[4]) else {
    print("usage: make_preview.swift <input.mov> <output.mp4> <start> <duration>")
    exit(2)
}

let asset = AVURLAsset(url: URL(fileURLWithPath: args[1]))
let outURL = URL(fileURLWithPath: args[2])
try? FileManager.default.removeItem(at: outURL)

let sem = DispatchSemaphore(value: 0)
Task {
    do {
        guard let track = try await asset.loadTracks(withMediaType: .video).first else { fatalError("no video track") }
        let size = try await track.load(.naturalSize)
        let target = CGSize(width: 886, height: 1920)

        let composition = AVMutableVideoComposition()
        composition.renderSize = target
        composition.frameDuration = CMTime(value: 1, timescale: 30)
        let instruction = AVMutableVideoCompositionInstruction()
        instruction.timeRange = CMTimeRange(start: .zero, duration: CMTime(seconds: length, preferredTimescale: 600))
        let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: track)
        layer.setTransform(CGAffineTransform(scaleX: target.width / size.width, y: target.height / size.height), at: .zero)
        instruction.layerInstructions = [layer]
        composition.instructions = [instruction]

        let trimmed = AVMutableComposition()
        let dest = trimmed.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)!
        let range = CMTimeRange(start: CMTime(seconds: start, preferredTimescale: 600), duration: CMTime(seconds: length, preferredTimescale: 600))
        try dest.insertTimeRange(range, of: track, at: .zero)
        let destLayer = AVMutableVideoCompositionLayerInstruction(assetTrack: dest)
        destLayer.setTransform(CGAffineTransform(scaleX: target.width / size.width, y: target.height / size.height), at: .zero)
        instruction.layerInstructions = [destLayer]

        let export = AVAssetExportSession(asset: trimmed, presetName: AVAssetExportPresetHighestQuality)!
        export.videoComposition = composition
        try await export.export(to: outURL, as: .mp4)
        print("wrote \(outURL.path)")
    } catch {
        print("failed: \(error)")
        exit(1)
    }
    sem.signal()
}
sem.wait()
