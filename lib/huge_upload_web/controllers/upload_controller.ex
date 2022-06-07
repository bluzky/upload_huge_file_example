defmodule HugeUpload.Upload do
  def schema do
    %{
      upload_id: [type: :string],
      file_size: [type: :integer, required: true],
      uploaded_size: [type: :integer, default: 0],
      md5: :string,
      filename: :string,
      uploaded_chunks: [
        type:
          {:array,
           %{
             chunk_number: :integer,
             chunk_size: :integer,
             file_path: :string,
             etag: :string,
             md5: :string
           }},
        default: []
      ],
      uploaded_chunk_count: [type: :integer, default: 0],
      chunk_count: [type: :integer, default: 1],
      upload_time: [type: :integer, default: 0],
      upload_dir: :string
    }
  end
end

defmodule HugeUploadWeb.UploadController do
  use HugeUploadWeb, :controller

  @init_schema %{
    filename: [type: :string, default: &Nanoid.generate/0],
    file_size: [type: :integer, required: true, number: [min: 1]],
    md5: [type: :string, required: true],
    chunk_count: [type: :integer, required: true, number: [min: 1]]
  }
  def init_upload(conn, params) do
    upload_id = Nanoid.generate()
    path = "#{System.tmp_dir()}/#{upload_id}"

    with {:ok, data} <- Tarams.cast(params, @init_schema),
         :ok <- File.mkdir(path) do
      data =
        Tarams.cast!(
          Map.merge(data, %{upload_dir: path, upload_id: upload_id}),
          HugeUpload.Upload.schema()
        )

      Cachex.put(:upload_file, upload_id, data)

      json(conn, %{
        status: "OK",
        data: %{
          upload_id: upload_id
        }
      })
    end
  end

  @upload_chunk_schema %{
    upload_id: [type: :string, required: true],
    chunk_number: [type: :integer, number: [min: 0]],
    chunk_data: [type: :any, required: true],
    chunk_size: [type: :integer, required: true, number: [min: 1]]
  }
  def upload_chunk(conn, params) do
    with {:ok, data} <- Tarams.cast(params, @upload_chunk_schema),
         {:ok, upload} <- Cachex.get(:upload_file, data.upload_id) do
      chunk_file = "#{upload.upload_dir}/chunk.#{data.chunk_number}"
      File.copy(data.chunk_data.path, chunk_file)

      chunk = %{
        chunk_number: data.chunk_number,
        chunk_size: data.chunk_size,
        file_path: chunk_file,
        etag: Nanoid.generate(),
        md5: hash_file(chunk_file)
      }

      upload = %{
        upload
        | uploaded_size: upload.uploaded_size + data.chunk_size,
          uploaded_chunk_count: upload.uploaded_chunk_count + 1,
          uploaded_chunks: [chunk | upload.uploaded_chunks]
      }

      Cachex.put(:upload_file, data.upload_id, upload)

      json(conn, %{
        status: "OK",
        etag: chunk.etag
      })
    end
  end

  def hash_file(file_path) do
    file_path
    |> File.stream!([], 16_384)
    |> Enum.reduce(:crypto.hash_init(:md5), fn chunk, digest ->
      :crypto.hash_update(digest, chunk)
    end)
    |> :crypto.hash_final()
    |> Base.encode16()
    |> String.downcase()
  end

  @complete_upload_schema %{
    upload_id: [type: :string, required: true],
    chunk_numbers: [type: {:array, :integer}]
  }
  def complete_upload(conn, params) do
    with {:ok, data} <- Tarams.cast(params, @complete_upload_schema),
         {:ok, upload} <- Cachex.get(:upload_file, data.upload_id),
         file_path <- "#{File.cwd!()}/#{upload.filename}",
         :ok <- validate_upload(upload, data.chunk_numbers),
         chunk_files <- sort_chunk_files(upload.uploaded_chunks, data.chunk_numbers),
         :ok <- merge_files(chunk_files, file_path),
         {:md5, true} <- {:md5, upload.md5 == hash_file(file_path)} do
      File.rm_rf!(upload.upload_dir)
      Cachex.del(:upload_file, data.upload_id)

      json(conn, %{
        status: "OK",
        file_path: file_path
      })
    else
      error ->
        json(conn, %{
          status: "ERROR",
          reason: inspect(error)
        })
    end
  end

  defp validate_upload(%{uploaded_chunks: chunks}, chunk_numbers) do
    cond do
      length(chunks) != length(chunk_numbers) ->
        {:error, "chunk length is not matched"}

      Enum.any?(chunks, &(&1.chunk_number not in chunk_numbers)) ->
        {:error, "chunk numbers are not matched"}

      true ->
        :ok
    end
  end

  defp sort_chunk_files(chunks, chunk_numbers) do
    chunk_map = Enum.into(chunks, %{}, &{&1.chunk_number, &1.file_path})
    Enum.map(chunk_numbers, &chunk_map[&1])
  end

  defp merge_files(chunk_files, final_file) do
    chunk_files
    |> Enum.map(&File.stream!(&1, [], 200_000))
    |> Stream.concat()
    |> Stream.into(File.stream!(final_file))
    |> Stream.run()
  end
end
