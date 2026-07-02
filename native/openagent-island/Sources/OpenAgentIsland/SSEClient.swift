import Foundation

final class SSEClient: NSObject, URLSessionDataDelegate {
	var onEvent: ((EventData) -> Void)?
	var onStatusChange: ((Bool) -> Void)?

	private var task: URLSessionDataTask?
	private var session: URLSession?
	private var buffer = ""
	private var currentURL: String?
	private var reconnectAttempts = 0
	private let maxReconnectAttempts = 10

	func connect(url urlString: String) {
		disconnect()

		currentURL = urlString
		reconnectAttempts = 0
		startConnection()
	}

	private func startConnection() {
		guard let urlString = currentURL,
		      let url = URL(string: urlString) else {
			print("Invalid URL: \(currentURL ?? "nil")")
			return
		}

		var request = URLRequest(url: url)
		request.timeoutInterval = .infinity
		request.setValue("text/event-stream", forHTTPHeaderField: "Accept")

		let config = URLSessionConfiguration.default
		config.timeoutIntervalForRequest = .infinity
		config.timeoutIntervalForResource = .infinity
		config.waitsForConnectivity = false

		session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
		task = session?.dataTask(with: request)
		task?.resume()

		print("SSE connecting to \(urlString) (attempt \(reconnectAttempts + 1))")
	}

	func disconnect() {
		currentURL = nil
		task?.cancel()
		task = nil
		session?.invalidateAndCancel()
		session = nil
		buffer = ""
	}

	// MARK: - URLSessionDataDelegate

	func urlSession(
		_ session: URLSession,
		dataTask: URLSessionDataTask,
		didReceive response: URLResponse,
		completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
	) {
		if let http = response as? HTTPURLResponse, http.statusCode == 200 {
			print("SSE connected")
			onStatusChange?(true)
		}
		completionHandler(.allow)
	}

	func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
		guard let chunk = String(data: data, encoding: .utf8) else { return }
		buffer += chunk

		while let range = buffer.range(of: "\n\n") {
			let block = String(buffer[buffer.startIndex..<range.lowerBound])
			buffer.removeSubrange(buffer.startIndex...range.upperBound)
			parseEventBlock(block)
		}
	}

	func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
		if let error {
			print("SSE disconnected: \(error.localizedDescription)")
		} else {
			print("SSE stream ended")
		}
		onStatusChange?(false)

		guard currentURL != nil else { return }
		reconnectAttempts += 1
		if reconnectAttempts > maxReconnectAttempts {
			print("SSE max reconnect attempts reached, giving up")
			return
		}

		let delay = min(3.0 * pow(2.0, Double(reconnectAttempts - 1)), 60.0)
		print("SSE reconnecting in \(Int(delay))s (attempt \(reconnectAttempts)/\(maxReconnectAttempts))")
		DispatchQueue.global().asyncAfter(deadline: .now() + delay) { [weak self] in
			guard let self, self.currentURL != nil else { return }
			self.task?.cancel()
			self.task = nil
			self.startConnection()
		}
	}

	// MARK: - Parsing

	private func parseEventBlock(_ block: String) {
		for line in block.split(separator: "\n", omittingEmptySubsequences: false) {
			let trimmed = line.trimmingCharacters(in: .whitespaces)
			guard trimmed.hasPrefix("data:") else { continue }
			let json = trimmed.dropFirst(5).trimmingCharacters(in: .whitespaces)

			guard let jsonData = json.data(using: .utf8),
			      let event = try? JSONDecoder().decode(EventData.self, from: jsonData)
			else { continue }

			DispatchQueue.main.async { self.onEvent?(event) }
		}
	}
}
