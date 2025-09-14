export default function SignIn({ onGoogle }) {
  return (
    <div className="bg-gray-900 text-gray-200 min-h-screen flex flex-col">
      <header className="w-full">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-20">
            <a href="#" className="flex items-center gap-3">
              <img src="/logo-swiftly.svg" alt="Swiftly" className="h-8 w-8" />
              <h1 className="text-2xl font-bold text-white">Swiftly</h1>
            </a>
          </div>
        </div>
      </header>

      <main className="flex-grow flex items-center justify-center">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="max-w-md mx-auto bg-gray-800 rounded-xl shadow-lg overflow-hidden md:max-w-2xl border border-gray-700">
            <div className="p-8 sm:p-12">
              <div className="text-center">
                <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
                  Welcome to Swiftly
                </h2>
                <p className="mt-4 text-lg text-gray-400">
                  A new era of messaging. Please sign in to continue.
                </p>
              </div>

              <div className="mt-8">
                <button
                  onClick={onGoogle}
                  className="w-full flex items-center justify-center px-8 py-3 border border-transparent text-base font-medium rounded-md text-white bg-[var(--primary-color)] hover:bg-opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--primary-color)] focus:ring-offset-gray-800 transition-all duration-300 ease-in-out"
                >
                  <svg className="h-6 w-6 mr-3" fill="currentColor" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
                    <path d="M224,128a96,96,0,1,1-21.95-61.09,8,8,0,1,1-12.33,10.18A80,80,0,1,0,207.6,136H128a8,8,0,0,1,0-16h88A8,8,0,0,1,224,128Z"></path>
                  </svg>
                  Sign in with Google
                </button>
              </div>

              <div className="mt-6">
                <p className="text-center text-sm text-gray-400">
                  By signing in, you agree to our{' '}
                  <a className="font-medium text-[var(--primary-color)] hover:underline" href="#">Terms of Service</a> and{' '}
                  <a className="font-medium text-[var(--primary-color)] hover:underline" href="#">Privacy Policy</a>.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer with Refora Technologies mention */}
      <footer className="py-6 text-center">
        <p className="text-sm text-gray-500">
          Made with ❤️ by{' '}
          <span className="text-[var(--primary-color)] font-medium">Refora Technologies</span>
        </p>
      </footer>
    </div>
  );
}