defmodule HugeUpload.Repo do
  use Ecto.Repo,
    otp_app: :huge_upload,
    adapter: Ecto.Adapters.Postgres
end
