import { useState } from 'react'
import { uploadFile } from '../lib/storage'  // <-- make sure the path is correct

export default function UploadTest() {
  const [url, setUrl] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return

    setError("")
    setLoading(true)
    try {
      // "guest" id since not using Firebase user uid yet
      const link = await uploadFile(file, 'guest')
      setUrl(link)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: '2rem' }}>
      <h1>Upload Test</h1>
      <input type="file" onChange={handleFile} />

      {loading && <p>Uploading…</p>}
      {error && <p style={{ color: 'red' }}>Error: {error}</p>}

      {url && (
        <div style={{ marginTop: '1rem' }}>
          <p>File uploaded to:</p>
          <a href={url} target="_blank" rel="noreferrer">{url}</a>
          <div>
            <img src={url} alt="uploaded" style={{maxWidth: '200px', marginTop: '1rem'}} />
          </div>
        </div>
      )}
    </div>
  )
}