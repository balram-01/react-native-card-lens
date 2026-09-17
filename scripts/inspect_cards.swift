import Foundation
import PDFKit
import Vision
import AppKit

func runOCR(image: NSImage, filename: String) {
    guard let tiffData = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiffData),
          let cgImage = bitmap.cgImage else {
        print("[-] Could not get CGImage for \(filename)")
        return
    }
    
    let requestHandler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    let request = VNRecognizeTextRequest { (request, error) in
        guard let observations = request.results as? [VNRecognizedTextObservation] else { return }
        print("\n=======================================================")
        print("FILE: \(filename)")
        print("-------------------------------------------------------")
        for observation in observations {
            if let topCandidate = observation.topCandidates(1).first {
                print(topCandidate.string)
            }
        }
        print("=======================================================\n")
    }
    
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    if #available(macOS 13.0, *) {
        request.recognitionLanguages = ["mr", "hi", "en", "gu", "ta", "te", "kn", "bn"]
    }
    
    try? requestHandler.perform([request])
}

let fileManager = FileManager.default
let testCardsDir = "test cards"

guard let files = try? fileManager.contentsOfDirectory(atPath: testCardsDir) else {
    print("Could not read directory")
    exit(1)
}

for file in files.sorted() {
    if file.hasPrefix(".") { continue }
    let path = "\(testCardsDir)/\(file)"
    
    if file.lowercased().hasSuffix(".pdf") {
        guard let doc = PDFDocument(url: URL(fileURLWithPath: path)) else { continue }
        for i in 0..<doc.pageCount {
            guard let page = doc.page(at: i) else { continue }
            let rect = page.bounds(for: .mediaBox)
            let img = NSImage(size: rect.size)
            img.lockFocus()
            if let ctx = NSGraphicsContext.current?.cgContext {
                ctx.setFillColor(NSColor.white.cgColor)
                ctx.fill(rect)
                page.draw(with: .mediaBox, to: ctx)
            }
            img.unlockFocus()
            runOCR(image: img, filename: "\(file) (Page \(i+1))")
        }
    } else if file.lowercased().hasSuffix(".png") || file.lowercased().hasSuffix(".jpg") || file.lowercased().hasSuffix(".jpeg") {
        if let img = NSImage(contentsOfFile: path) {
            runOCR(image: img, filename: file)
        }
    }
}
