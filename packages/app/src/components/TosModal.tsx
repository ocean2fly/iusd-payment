/** Simple ToS modal — no store/service dependencies */
interface Props {
  onAccept: () => void
  onDecline: () => void
}

export function TosModal({ onAccept, onDecline }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm px-4 pb-4 sm:pb-0">
      <div className="w-full max-w-sm bg-[#111] border border-white/10 rounded-2xl p-6 flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <h2 className="text-white/80 text-sm font-medium tracking-wide">Terms of Service</h2>
          <p className="text-white/40 text-xs leading-relaxed">
            By connecting your wallet you agree to the iUSD Pay terms of service and privacy policy.
            This app is experimental — use at your own risk.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onDecline}
            className="flex-1 border border-white/10 text-white/40 rounded-xl py-2.5 text-xs tracking-widest uppercase hover:bg-white/5 transition-colors"
          >
            Decline
          </button>
          <button
            onClick={onAccept}
            className="flex-1 border border-white/20 text-white/70 rounded-xl py-2.5 text-xs tracking-widest uppercase hover:bg-white/10 transition-colors"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  )
}
