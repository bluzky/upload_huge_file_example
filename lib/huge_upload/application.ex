defmodule HugeUpload.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      # Start the Ecto repository
      HugeUpload.Repo,
      # Start the Telemetry supervisor
      HugeUploadWeb.Telemetry,
      # Start the PubSub system
      {Phoenix.PubSub, name: HugeUpload.PubSub},
      # Start the Endpoint (http/https)
      HugeUploadWeb.Endpoint,
      {Cachex, name: :upload_file}
      # Start a worker by calling: HugeUpload.Worker.start_link(arg)
      # {HugeUpload.Worker, arg}
    ]

    # See https://hexdocs.pm/elixir/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: HugeUpload.Supervisor]
    Supervisor.start_link(children, opts)
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    HugeUploadWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
