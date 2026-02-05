import SwiftUI

struct SettingsView: View {
    @AppStorage("serverURL") private var serverURL = "http://localhost:8000"
    @AppStorage("hapticEnabled") private var hapticEnabled = true

    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("Server")) {
                    TextField("Backend URL", text: $serverURL)
                        .autocapitalization(.none)
                        .keyboardType(.URL)

                    Button("Test Connection") {
                        testConnection()
                    }
                }

                Section(header: Text("Feedback")) {
                    Toggle("Haptic Feedback", isOn: $hapticEnabled)
                }

                Section(header: Text("About")) {
                    HStack {
                        Text("Version")
                        Spacer()
                        Text("1.0.0")
                            .foregroundColor(.secondary)
                    }
                }
            }
            .navigationTitle("Settings")
        }
    }

    private func testConnection() {
        Task {
            do {
                let url = URL(string: serverURL + "/health")!
                let (_, response) = try await URLSession.shared.data(from: url)

                if let httpResponse = response as? HTTPURLResponse,
                   httpResponse.statusCode == 200 {
                    // Success haptic
                    let generator = UINotificationFeedbackGenerator()
                    generator.notificationOccurred(.success)
                } else {
                    let generator = UINotificationFeedbackGenerator()
                    generator.notificationOccurred(.error)
                }
            } catch {
                let generator = UINotificationFeedbackGenerator()
                generator.notificationOccurred(.error)
            }
        }
    }
}
