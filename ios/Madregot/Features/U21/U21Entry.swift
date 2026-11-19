import SwiftUI

/// "Madregot Personal Coach · U21" — the section at the bottom of registration. The whole
/// flow is native SwiftUI (owner, Nov 19: part of the app, never a web page or web view):
/// track → questionnaire (one section per step) → review → confirmation.
///
/// DEMO: nothing is submitted. The confirmation says so on screen. Persistence was proven
/// on the web path (one synthetic row on dev); this flow adds no new row. No prices are
/// shown — the draft prices have no approved source.
struct U21EntryCard: View {
    @State private var showFlow = false

    var body: some View {
        Button { showFlow = true } label: {
            HStack(spacing: 14) {
                Text("U21")
                    .font(Theme.font(17, .black)).foregroundStyle(Theme.ink900)
                    .frame(width: 52, height: 52)
                    .background(.white, in: .rect(cornerRadius: 14))
                VStack(alignment: .leading, spacing: 2) {
                    Text("Madregot Personal Coach").font(Theme.font(17, .black)).foregroundStyle(.white)
                    Text("בלי סטראבה או גוגל · בוחרים מסלול ונכנסים")
                        .font(Theme.font(13, .semibold)).foregroundStyle(.white.opacity(0.8))
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.left").font(.system(size: 14, weight: .bold)).foregroundStyle(.white.opacity(0.7))
            }
            .padding(16)
            .frame(maxWidth: .infinity)
            .background(Theme.ink900, in: .rect(cornerRadius: Theme.radius))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("open-u21")
        .fullScreenCover(isPresented: $showFlow) { U21Flow(onClose: { showFlow = false }) }
    }
}

// MARK: - Flow

struct U21Flow: View {
    let onClose: () -> Void
    @State private var track: U21Track?
    @State private var answers: [String: U21Answer] = U21Flow.initialAnswers
    @State private var step = 0          // 0 = track, 1…n = sections, n+1 = review, n+2 = done
    @State private var errors: [String: String] = [:]

    private let sections = U21Intake.sections

    /// DEBUG-only `-u21Prefill`: fictitious answers so the review and demo confirmation can be
    /// reached in the Simulator without typing 28 fields. Never compiled into Release; never sent.
    static var initialAnswers: [String: U21Answer] {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-u21Prefill") {
            let birth = Calendar.current.date(byAdding: .year, value: -19, to: .now)!
            return [
                "firstName": .text("בדיקה"), "lastName": .text("בדיקה"), "email": .text("test@example.com"),
                "phone": .text("050-0000000"), "birthDate": .date(birth),
                "framework": .choice("שנת שירות"), "goal": .text("שיפור 3 ק״מ (בדיקה)"),
                "experience": .choice("1–3 שנים"), "runsPerWeek": .choice("3–4"), "strengthExperience": .choice("מעט"),
                "availableDays": .choices(["ראשון", "שלישי", "חמישי"]),
                "sleepHours": .choice("7–8"),
                "chestPain": .flag(false), "fainting": .flag(false), "bonePain": .flag(false), "acuteInjury": .flag(false),
            ]
        }
        #endif
        return [:]
    }
    private var reviewStep: Int { sections.count + 1 }
    private var doneStep: Int { sections.count + 2 }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if step > 0 && step < doneStep { progress }
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        if step == 0 { trackPicker }
                        else if step <= sections.count { sectionForm(sections[step - 1]) }
                        else if step == reviewStep { review }
                        else { confirmation }
                    }
                    .padding(Theme.gutter)
                }
                if step > 0 && step < doneStep { footer }
            }
            .background(Theme.page)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("U21 · מאמן אישי").font(Theme.font(17, .black)).foregroundStyle(Theme.ink900)
                }
                ToolbarItem(placement: .topBarLeading) {
                    Button { onClose() } label: { Image(systemName: "xmark") }
                        .accessibilityLabel("סגירה")
                }
            }
        }
        .tint(Theme.ink900)
    }

    // MARK: steps

    private var trackPicker: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("בוחרים מסלול").font(Theme.font(26, .black)).foregroundStyle(Theme.ink900)
            Text("ליווי ריצה, כוח ומוביליטי לגילאי 16–21. בלי חיבור לסטראבה או לגוגל, ובלי תשלום בשלב הזה.")
                .font(Theme.font(15)).foregroundStyle(Theme.ink500)
            ForEach(U21Track.allCases) { t in
                Button {
                    track = t; step = 1; errors = [:]
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(t.name).font(Theme.font(18, .black)).foregroundStyle(Theme.ink900)
                            Text(t.tagline).font(Theme.font(14)).foregroundStyle(Theme.ink500)
                        }
                        Spacer()
                        Image(systemName: "chevron.left").foregroundStyle(Theme.ink300)
                    }
                    .padding(16)
                    .background(Theme.card, in: .rect(cornerRadius: 18))
                    .overlay(RoundedRectangle(cornerRadius: 18).stroke(track == t ? Theme.ink900 : .clear, lineWidth: 2))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("u21-track-\(t.rawValue)")
            }
            notes
        }
    }

    private func sectionForm(_ section: String) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(section).font(Theme.font(24, .black)).foregroundStyle(Theme.ink900)
            ForEach(U21Intake.fields.filter { $0.section == section && U21Intake.visible($0, answers: answers) }) { f in
                U21FieldView(field: f, answer: binding(f.key), error: errors[f.key])
            }
            notes
        }
    }

    private var review: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("סקירת פרטים").font(Theme.font(24, .black)).foregroundStyle(Theme.ink900)
            row("מסלול", track?.name ?? "–")
            ForEach(sections, id: \.self) { section in
                VStack(alignment: .leading, spacing: 8) {
                    Text(section).font(Theme.font(13, .bold)).foregroundStyle(Theme.ink500)
                    ForEach(U21Intake.fields.filter { $0.section == section && U21Intake.visible($0, answers: answers) }) { f in
                        if let v = display(answers[f.key]) { row(f.label, v) }
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.card, in: .rect(cornerRadius: 16))
            }
            if U21Intake.redFlag(answers) {
                Label("סימנת אחד מסימני הבטיחות. המאמן יראה זאת לפני כל תוכנית.", systemImage: "exclamationmark.triangle")
                    .font(Theme.font(13, .semibold)).foregroundStyle(Theme.danger)
            }
            notes
        }
    }

    private var confirmation: some View {
        VStack(spacing: 14) {
            Text("מצב הדגמה · לא נשלח")
                .font(Theme.font(12, .black)).foregroundStyle(.white)
                .padding(.horizontal, 12).padding(.vertical, 5)
                .background(Theme.ink900, in: .capsule)
                .accessibilityIdentifier("u21-demo-badge")
            Image(systemName: "checkmark.circle.fill").font(.system(size: 56)).foregroundStyle(Theme.ink900)
            Text("הבקשה מוכנה").font(Theme.font(26, .black)).foregroundStyle(Theme.ink900)
            Text("זו הדגמה של התהליך באפליקציה. הפרטים לא נשלחו ולא נשמרו בשום מקום. בגרסה המלאה, הבקשה תגיע למאמן לבדיקה ונחזור אליך.")
                .font(Theme.font(15)).foregroundStyle(Theme.ink500).multilineTextAlignment(.center)
            notes
            Button("סיום") { onClose() }.buttonStyle(BrandButtonStyle()).padding(.top, 8)
        }
        .padding(24)
        .frame(maxWidth: .infinity)
        .background(Theme.card, in: .rect(cornerRadius: Theme.radius))
    }

    // MARK: chrome

    private var progress: some View {
        let total = sections.count + 1
        return HStack(spacing: 4) {
            ForEach(1...total, id: \.self) { i in
                Capsule().fill(i <= step ? Theme.ink900 : Theme.ink300.opacity(0.5)).frame(height: 4)
            }
        }
        .padding(.horizontal, Theme.gutter).padding(.top, 8)
    }

    private var footer: some View {
        HStack(spacing: 12) {
            Button("חזרה") { errors = [:]; step -= 1 }
                .font(Theme.font(16, .bold)).foregroundStyle(Theme.ink700)
                .frame(maxWidth: .infinity, minHeight: Theme.controlHeight)
                .overlay(Capsule().stroke(Theme.ink300, lineWidth: 1))
            Button(step == reviewStep ? "שליחה (הדגמה)" : "המשך") { advance() }
                .buttonStyle(BrandButtonStyle())
                .accessibilityIdentifier("u21-next")
        }
        .padding(Theme.gutter)
        .background(Theme.page)
    }

    private var notes: some View {
        Text(U21Intake.testNote).font(Theme.font(12, .semibold)).foregroundStyle(Theme.ink500)
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.card, in: .rect(cornerRadius: 12))
    }

    private func advance() {
        if step <= sections.count {
            errors = U21Intake.errors(section: sections[step - 1], answers: answers)
            guard errors.isEmpty else { return }
        }
        step += 1
    }

    private func binding(_ key: String) -> Binding<U21Answer?> {
        Binding(get: { answers[key] }, set: { answers[key] = $0; errors[key] = nil })
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top) {
            Text(label).font(Theme.font(13)).foregroundStyle(Theme.ink500)
            Spacer(minLength: 12)
            Text(value).font(Theme.font(14, .bold)).foregroundStyle(Theme.ink900).multilineTextAlignment(.trailing)
        }
    }

    private func display(_ a: U21Answer?) -> String? {
        switch a {
        case .text(let t)? where !t.isEmpty: t
        case .choice(let c)?: c
        case .choices(let s)? where !s.isEmpty: s.sorted().joined(separator: ", ")
        case .flag(let b)?: b ? "כן" : "לא"
        case .date(let d)?: d.formatted(.dateTime.day().month().year())
        default: nil
        }
    }
}

// MARK: - One field

struct U21FieldView: View {
    let field: U21Field
    @Binding var answer: U21Answer?
    let error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(field.label + (field.required ? " *" : ""))
                .font(Theme.font(15, .bold)).foregroundStyle(Theme.ink900)
            input
            if field.kind == .date {
                Text(U21Intake.dateHint).font(Theme.font(12)).foregroundStyle(Theme.ink500)
            }
            if field.isDraft {
                Text(U21Intake.draftNote).font(Theme.font(11, .bold)).foregroundStyle(Theme.ink500)
            }
            if let error { Text(error).font(Theme.font(12, .bold)).foregroundStyle(Theme.danger) }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card, in: .rect(cornerRadius: 16))
        .accessibilityIdentifier("u21-field-\(field.key)")
    }

    @ViewBuilder private var input: some View {
        switch field.kind {
        case .text, .email, .tel, .number, .textarea:
            TextField(field.placeholder ?? "", text: textBinding, axis: field.kind == .textarea ? .vertical : .horizontal)
                .lineLimit(field.kind == .textarea ? 3...6 : 1...1)
                .keyboardType(field.kind == .email ? .emailAddress : field.kind == .tel ? .phonePad : field.kind == .number ? .numberPad : .default)
                .textInputAutocapitalization(field.kind == .email ? .never : .sentences)
                .font(Theme.font(16))
                .modifier(BrandFieldStyle(height: 44))
        case .date:
            // No pre-filled date: until one is chosen the field is visibly empty.
            if case .date? = answer {
                DatePicker("", selection: dateBinding, displayedComponents: .date)
                    .labelsHidden().environment(\.locale, Locale(identifier: "he_IL"))
            } else {
                Button {
                    answer = .date(Calendar.current.date(byAdding: .year, value: -18, to: .now)!)
                } label: {
                    Label("בחירת תאריך", systemImage: "calendar")
                        .font(Theme.font(15, .bold)).foregroundStyle(Theme.ink900)
                        .padding(.horizontal, 14).padding(.vertical, 9)
                        .background(Theme.page, in: .capsule)
                }
                .buttonStyle(.plain)
            }
        case .radio(let options):
            FlowChips(options: options, selected: { answer == .choice($0) }) { answer = .choice($0) }
        case .checkboxes(let options):
            FlowChips(options: options, selected: { set.contains($0) }) { o in
                var s = set; if s.contains(o) { s.remove(o) } else { s.insert(o) }; answer = .choices(s)
            }
        case .yesno:
            FlowChips(options: ["כן", "לא"], selected: { (answer == .flag(true) && $0 == "כן") || (answer == .flag(false) && $0 == "לא") }) {
                answer = .flag($0 == "כן")
            }
        case .checkbox:
            Toggle("מאשר/ת", isOn: Binding(get: { answer == .flag(true) }, set: { answer = .flag($0) }))
                .font(Theme.font(15)).tint(Theme.ink900)
        }
    }

    private var set: Set<String> { if case .choices(let s)? = answer { s } else { [] } }
    private var textBinding: Binding<String> {
        Binding(get: { if case .text(let t)? = answer { t } else { "" } }, set: { answer = .text($0) })
    }
    private var dateBinding: Binding<Date> {
        Binding(get: { if case .date(let d)? = answer { d } else { Calendar.current.date(byAdding: .year, value: -18, to: .now)! } },
                set: { answer = .date($0) })
    }
}

/// Wrapping pill choices (radio / multi-select / yes-no) in the app's black-and-white look.
struct FlowChips: View {
    let options: [String]
    let selected: (String) -> Bool
    let tap: (String) -> Void
    var body: some View {
        WrapLayout(spacing: 8) {
            ForEach(options, id: \.self) { o in
                let on = selected(o)
                Button { tap(o) } label: {
                    Text(o).font(Theme.font(14, .bold))
                        .foregroundStyle(on ? .white : Theme.ink900)
                        .padding(.horizontal, 14).padding(.vertical, 9)
                        .background(on ? Theme.ink900 : Theme.page, in: .capsule)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

struct WrapLayout: Layout {
    var spacing: CGFloat = 8
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 320
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x + size.width > width, x > 0 { x = 0; y += rowH + spacing; rowH = 0 }
            x += size.width + spacing; rowH = max(rowH, size.height)
        }
        return CGSize(width: width, height: y + rowH)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowH: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX, x > bounds.minX { x = bounds.minX; y += rowH + spacing; rowH = 0 }
            s.place(at: CGPoint(x: x, y: y), proposal: .unspecified)
            x += size.width + spacing; rowH = max(rowH, size.height)
        }
    }
}
